import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Site } from '@korporia/jornada';
import type { AppEnv } from '../../env';
import { requireAuth, requirePermission, resolveCompany } from '../../lib/auth';
import { loadCredentials, PIN_RE, verifySecret } from '../../lib/pin';
import { adminClient, coreDb, jornadaDb, userClient } from '../../lib/supabase';
import { workerDocsState } from '../../lib/worker-docs';
import { decidePunch, parsePunchInput } from './punch-rules';

const MAX_SELFIE_BYTES = 400 * 1024;
const SELFIE_TYPES = ['image/jpeg', 'image/webp'];

export const punches = new Hono<AppEnv>();
punches.use('*', requireAuth);

/**
 * Registra una checada. Cuerpo multipart:
 *   data   → JSON con los campos de PunchInput
 *   selfie → imagen JPEG/WebP (≤ 400 KB), solo si el trabajador autorizó el uso de su rostro
 *   pin    → PIN de 4 dígitos, si checa sin biometría (no autorizó o retiró su consentimiento)
 *
 * Antes de su primera checada el trabajador debe firmar el aviso de privacidad y el
 * acuerdo de registro electrónico de jornada (Legal).
 */
punches.post('/', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'jornada.checar');
  const admin = adminClient(c.env);
  const core = coreDb(admin);
  const db = jornadaDb(admin);
  const body = await c.req.parseBody();

  let raw: unknown;
  try {
    raw = JSON.parse(String(body.data ?? ''));
  } catch {
    throw new HTTPException(400, { message: 'Datos de checada inválidos.' });
  }
  const input = parsePunchInput(raw);
  if (typeof input === 'string') throw new HTTPException(400, { message: input });

  // Colaborador asociado al usuario
  const { data: employee } = await core
    .from('employees')
    .select('id, company_id, active, full_name, employee_number')
    .eq('company_id', companyId)
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (!employee) throw new HTTPException(403, { message: 'Tu usuario no está registrado como colaborador.' });
  if (!employee.active) throw new HTTPException(403, { message: 'Tu usuario está dado de baja. Habla con tu supervisor.' });

  // Idempotencia: si la cola sin conexión reenvía una checada ya guardada, se devuelve la existente
  const existing = await db
    .from('punches')
    .select('id, kind, server_ts, flags')
    .eq('company_id', companyId)
    .eq('client_uuid', input.client_uuid)
    .maybeSingle();
  if (existing.data) return c.json({ punch: existing.data, duplicate: true });

  const [{ data: settings }, { data: sites }, { data: last }, { data: face }, { data: own }] = await Promise.all([
    db.from('settings').select('face_match_threshold').eq('company_id', companyId).maybeSingle(),
    core.from('sites').select('id, name, lat, lng, radius_m, geofence_mode, active').eq('company_id', companyId).eq('active', true),
    db
      .from('punches')
      .select('kind, server_ts, lat, lng')
      .eq('employee_id', employee.id)
      .order('server_ts', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from('faces').select('employee_id').eq('employee_id', employee.id).maybeSingle(),
    db.from('employee_settings').select('consent_confirmed_at').eq('employee_id', employee.id).maybeSingle(),
  ]);
  // La suspensión de la cuenta ya la revisó requirePermission (402)

  // Firmas pendientes (aviso y acuerdo de jornada) y método de identificación
  const docs = await workerDocsState(c.env, { ...employee, company_id: companyId });
  if (docs.pending.some((d) => d !== 'biometria')) {
    return c.json({ error: 'Antes de checar, lee y firma tu aviso de privacidad y el acuerdo de registro de jornada.', code: 'documents' }, 428);
  }
  const biometric = docs.biometric === 'autorizo' && Boolean(own?.consent_confirmed_at);

  let selfie: File | null = null;
  let pinOk: boolean | undefined;
  if (biometric) {
    const file = body.selfie;
    if (!(file instanceof File)) throw new HTTPException(400, { message: 'Falta la selfie.' });
    if (!SELFIE_TYPES.includes(file.type)) throw new HTTPException(400, { message: 'Formato de imagen no permitido.' });
    if (file.size > MAX_SELFIE_BYTES) throw new HTTPException(413, { message: 'La imagen es demasiado grande.' });
    selfie = file;
  } else {
    // Sin biometría no se guarda ninguna foto: la identidad la da el PIN
    const pin = typeof body.pin === 'string' ? body.pin : '';
    if (!PIN_RE.test(pin)) {
      return c.json({ error: 'Escribe tu PIN de 4 dígitos para checar.', code: 'pin_required' }, 400);
    }
    const creds = await loadCredentials(c.env, employee.id);
    pinOk = await verifySecret(pin, creds?.pin_hash);
  }

  const decision = decidePunch(input, {
    sites: (sites ?? []) as Site[],
    lastPunch: last ?? null,
    faceThreshold: Number(settings?.face_match_threshold ?? 0.55),
    hasFaceReference: Boolean(face),
    consentConfirmed: Boolean(own?.consent_confirmed_at),
    pin: pinOk,
    now: new Date(),
  });
  if (!decision.ok) {
    return c.json({ error: decision.message, code: decision.code }, decision.status);
  }

  // Guardar selfie en R2 (solo con consentimiento biométrico)
  let selfiePath: string | null = null;
  if (selfie) {
    const month = new Date().toISOString().slice(0, 7);
    const ext = selfie.type === 'image/webp' ? 'webp' : 'jpg';
    selfiePath = `selfies/${companyId}/${employee.id}/${month}/${input.client_uuid}.${ext}`;
    await c.env.FILES.put(selfiePath, await selfie.arrayBuffer(), {
      httpMetadata: { contentType: selfie.type },
      customMetadata: { company: companyId, employee: employee.id },
    });
  }

  const { data: inserted, error } = await db
    .from('punches')
    .insert({
      company_id: companyId,
      employee_id: employee.id,
      site_id: decision.geofence.site?.id ?? null,
      kind: input.kind,
      device_ts: input.device_ts,
      captured_offline: input.captured_offline ?? false,
      lat: input.lat,
      lng: input.lng,
      accuracy_m: input.accuracy_m,
      distance_m: decision.geofence.distance_m,
      inside_geofence: decision.geofence.site ? decision.geofence.inside : null,
      face_score: biometric ? input.face_score : null,
      face_matched: decision.faceMatched,
      liveness_passed: biometric ? input.liveness_passed : null,
      antispoof_score: biometric ? input.antispoof_score : null,
      model_version: biometric ? input.model_version : null,
      selfie_path: selfiePath,
      flags: decision.flags,
      device_info: {
        ...input.device_info,
        ua: c.req.header('User-Agent')?.slice(0, 300),
        ip_country: c.req.header('CF-IPCountry'),
      },
      client_uuid: input.client_uuid,
      created_by: auth.userId,
    })
    .select('id, kind, server_ts, flags, site_id, seq')
    .single();

  if (error) {
    // Carrera entre dos envíos de la misma checada
    if (error.code === '23505') {
      const again = await db
        .from('punches')
        .select('id, kind, server_ts, flags')
        .eq('company_id', companyId)
        .eq('client_uuid', input.client_uuid)
        .single();
      if (again.data) return c.json({ punch: again.data, duplicate: true });
    }
    if (selfiePath) await c.env.FILES.delete(selfiePath);
    console.error('punch insert failed', error);
    throw new HTTPException(500, { message: 'No se pudo guardar la checada. Intenta de nuevo.' });
  }

  return c.json({ punch: inserted, site: decision.geofence.site?.name ?? null }, 201);
});

/**
 * Checadas visibles para el usuario según sus permisos (RLS): las propias, las de sus obras
 * o las de toda la empresa. Filtros: from, to (ISO), employee_id, site_id, limit.
 */
punches.get('/', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'jornada.registros.propios', 'jornada.asistencia.ver', 'jornada.asistencia.ver_asignadas');
  const user = userClient(c.env, auth.accessToken);
  const from = c.req.query('from');
  const to = c.req.query('to');
  const employeeId = c.req.query('employee_id');
  const siteId = c.req.query('site_id');
  const limit = Math.min(Number(c.req.query('limit') ?? 200) || 200, 1000);

  let q = jornadaDb(user)
    .from('punches')
    .select(
      'id, employee_id, site_id, kind, server_ts, device_ts, captured_offline, lat, lng, accuracy_m, distance_m, inside_geofence, face_score, face_matched, liveness_passed, selfie_path, flags, seq',
    )
    .eq('company_id', companyId)
    .order('server_ts', { ascending: false })
    .limit(limit);
  if (from) q = q.gte('server_ts', from);
  if (to) q = q.lt('server_ts', to);
  if (employeeId) q = q.eq('employee_id', employeeId);
  if (siteId) q = q.eq('site_id', siteId);

  const { data, error } = await q;
  if (error) throw new HTTPException(500, { message: 'No se pudieron consultar las checadas.' });

  // Nombres de colaboradores y obras (viven en core; también pasan por RLS)
  const rows = data ?? [];
  const employeeIds = [...new Set(rows.map((r) => r.employee_id))];
  const siteIds = [...new Set(rows.map((r) => r.site_id).filter((s): s is string => Boolean(s)))];
  const core = coreDb(user);
  const [{ data: employees }, { data: sites }] = await Promise.all([
    employeeIds.length ? core.from('employees').select('id, full_name, employee_number').in('id', employeeIds) : Promise.resolve({ data: [] }),
    siteIds.length ? core.from('sites').select('id, name').in('id', siteIds) : Promise.resolve({ data: [] }),
  ]);
  const employeeById = new Map((employees ?? []).map((e) => [e.id, { full_name: e.full_name, employee_number: e.employee_number }]));
  const siteById = new Map((sites ?? []).map((s) => [s.id, { name: s.name }]));

  return c.json({
    punches: rows.map((r) => ({
      ...r,
      employees: employeeById.get(r.employee_id) ?? null,
      sites: r.site_id ? (siteById.get(r.site_id) ?? null) : null,
    })),
  });
});

const KIND_LABEL: Record<string, string> = { in: 'Entrada', break_start: 'Inicio de descanso', break_end: 'Fin de descanso', out: 'Salida' };
const SOURCE_LABEL: Record<string, string> = { original: 'Original', adjusted: 'Corregida', manual: 'Agregada por corrección' };
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * "Mis registros": el trabajador descarga su historial de jornada (con correcciones),
 * aunque el checador de su plan ya haya terminado.
 *   GET /api/jornada/punches/mine.csv?from=2027-01-01&to=2027-01-31  (fechas locales, inclusive)
 */
punches.get('/mine.csv', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'jornada.registros.propios');
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new HTTPException(400, { message: 'Indica un periodo válido.' });
  }
  const admin = adminClient(c.env);
  const core = coreDb(admin);
  const [{ data: employee }, { data: company }] = await Promise.all([
    core.from('employees').select('id, full_name, employee_number').eq('company_id', companyId).eq('user_id', auth.userId).maybeSingle(),
    core.from('companies').select('name, timezone').eq('id', companyId).single(),
  ]);
  if (!employee) throw new HTTPException(403, { message: 'Tu usuario no está registrado como colaborador.' });
  const tz = company?.timezone ?? 'America/Mexico_City';

  // Margen de un día a cada lado; se filtra por fecha local abajo
  const start = new Date(`${from}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  const [{ data: rows, error }, { data: sites }] = await Promise.all([
    jornadaDb(admin)
      .from('effective_punches')
      .select('ts, original_ts, kind, source, site_id, flags')
      .eq('employee_id', employee.id)
      .gte('ts', start.toISOString())
      .lt('ts', end.toISOString())
      .order('ts'),
    core.from('sites').select('id, name').eq('company_id', companyId),
  ]);
  if (error) throw new HTTPException(500, { message: 'No se pudieron consultar tus registros.' });
  const siteName = new Map((sites ?? []).map((s) => [s.id, s.name]));
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFmt = new Intl.DateTimeFormat('es-MX', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });

  const lines = [
    [`Registros de jornada de ${employee.full_name} (${employee.employee_number}) · ${company?.name ?? ''}`],
    [`Periodo ${from} a ${to} · hora local (${tz})`],
    [],
    ['Fecha', 'Hora', 'Registro', 'Obra o sucursal', 'Origen', 'Hora original', 'Método'],
  ];
  for (const r of rows ?? []) {
    const day = dateFmt.format(new Date(r.ts));
    if (day < from || day > to) continue;
    const flags = (r.flags ?? []) as string[];
    lines.push([
      day,
      timeFmt.format(new Date(r.ts)),
      KIND_LABEL[r.kind] ?? r.kind,
      r.site_id ? (siteName.get(r.site_id) ?? '') : '',
      SOURCE_LABEL[r.source] ?? r.source,
      r.source === 'adjusted' && r.original_ts ? timeFmt.format(new Date(r.original_ts)) : '',
      r.source === 'manual' ? '' : flags.includes('pin') ? 'PIN' : 'Selfie',
    ]);
  }
  const csv = '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mis-registros-${from}-a-${to}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
