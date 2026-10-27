import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Site } from '@jornadia/core';
import type { AppEnv } from '../env';
import { requireAuth, resolveCompany } from '../auth';
import { adminClient, userClient } from '../supabase';
import { decidePunch, parsePunchInput } from '../punch-rules';

const MAX_SELFIE_BYTES = 400 * 1024;
const SELFIE_TYPES = ['image/jpeg', 'image/webp'];

export const punches = new Hono<AppEnv>();
punches.use('*', requireAuth);

/**
 * Registra una checada. Cuerpo multipart:
 *   data   → JSON con los campos de PunchInput
 *   selfie → imagen JPEG/WebP (≤ 400 KB)
 */
punches.post('/', async (c) => {
  const auth = c.get('auth');
  const admin = adminClient(c.env);
  const body = await c.req.parseBody();

  let raw: unknown;
  try {
    raw = JSON.parse(String(body.data ?? ''));
  } catch {
    throw new HTTPException(400, { message: 'Datos de checada inválidos.' });
  }
  const input = parsePunchInput(raw);
  if (typeof input === 'string') throw new HTTPException(400, { message: input });

  const selfie = body.selfie;
  if (!(selfie instanceof File)) throw new HTTPException(400, { message: 'Falta la selfie.' });
  if (!SELFIE_TYPES.includes(selfie.type)) throw new HTTPException(400, { message: 'Formato de imagen no permitido.' });
  if (selfie.size > MAX_SELFIE_BYTES) throw new HTTPException(413, { message: 'La imagen es demasiado grande.' });

  // Trabajador asociado al usuario
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  const { data: employee } = await admin
    .from('employees')
    .select('id, company_id, active, consent_confirmed_at')
    .eq('company_id', companyId)
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (!employee) throw new HTTPException(403, { message: 'Tu usuario no está registrado como trabajador.' });
  if (!employee.active) throw new HTTPException(403, { message: 'Tu usuario está dado de baja. Habla con tu supervisor.' });

  // Idempotencia: si la cola sin conexión reenvía una checada ya guardada, se devuelve la existente
  const existing = await admin
    .from('punches')
    .select('id, kind, server_ts, flags')
    .eq('company_id', companyId)
    .eq('client_uuid', input.client_uuid)
    .maybeSingle();
  if (existing.data) return c.json({ punch: existing.data, duplicate: true });

  const [{ data: company }, { data: sites }, { data: last }, { data: face }] = await Promise.all([
    admin.from('companies').select('status, face_match_threshold').eq('id', companyId).single(),
    admin.from('sites').select('id, name, lat, lng, radius_m, geofence_mode, active').eq('company_id', companyId).eq('active', true),
    admin
      .from('punches')
      .select('kind, server_ts, lat, lng')
      .eq('employee_id', employee.id)
      .order('server_ts', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('employee_faces').select('employee_id').eq('employee_id', employee.id).maybeSingle(),
  ]);
  if (!company) throw new HTTPException(404, { message: 'Empresa no encontrada.' });
  if (company.status === 'suspended' || company.status === 'archived') {
    throw new HTTPException(402, { message: 'La cuenta de tu empresa está suspendida. Avisa a tu administrador.' });
  }

  const decision = decidePunch(input, {
    sites: (sites ?? []) as Site[],
    lastPunch: last ?? null,
    faceThreshold: Number(company.face_match_threshold),
    hasFaceReference: Boolean(face),
    consentConfirmed: Boolean(employee.consent_confirmed_at),
    now: new Date(),
  });
  if (!decision.ok) {
    return c.json({ error: decision.message, code: decision.code }, decision.status);
  }

  // Guardar selfie en R2
  const month = new Date().toISOString().slice(0, 7);
  const ext = selfie.type === 'image/webp' ? 'webp' : 'jpg';
  const selfiePath = `selfies/${companyId}/${employee.id}/${month}/${input.client_uuid}.${ext}`;
  await c.env.FILES.put(selfiePath, await selfie.arrayBuffer(), {
    httpMetadata: { contentType: selfie.type },
    customMetadata: { company: companyId, employee: employee.id },
  });

  const { data: inserted, error } = await admin
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
      face_score: input.face_score,
      face_matched: decision.faceMatched,
      liveness_passed: input.liveness_passed,
      antispoof_score: input.antispoof_score,
      model_version: input.model_version,
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
      const again = await admin
        .from('punches')
        .select('id, kind, server_ts, flags')
        .eq('company_id', companyId)
        .eq('client_uuid', input.client_uuid)
        .single();
      if (again.data) return c.json({ punch: again.data, duplicate: true });
    }
    await c.env.FILES.delete(selfiePath);
    console.error('punch insert failed', error);
    throw new HTTPException(500, { message: 'No se pudo guardar la checada. Intenta de nuevo.' });
  }

  return c.json({ punch: inserted, site: decision.geofence.site?.name ?? null }, 201);
});

/** Checadas visibles para el usuario según su rol (RLS). Filtros: from, to (ISO), employee_id, site_id. */
punches.get('/', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  const db = userClient(c.env, auth.accessToken);
  const from = c.req.query('from');
  const to = c.req.query('to');
  const employeeId = c.req.query('employee_id');
  const siteId = c.req.query('site_id');
  const limit = Math.min(Number(c.req.query('limit') ?? 200) || 200, 1000);

  let q = db
    .from('punches')
    .select(
      'id, employee_id, site_id, kind, server_ts, device_ts, captured_offline, lat, lng, accuracy_m, distance_m, inside_geofence, face_score, face_matched, liveness_passed, selfie_path, flags, seq, employees(full_name, employee_number), sites(name)',
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
  return c.json({ punches: data });
});
