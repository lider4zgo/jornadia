import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { CONTRACT_TYPES, isValidCurp, isValidNss, isValidRfc, ONBOARDING_DOCUMENTS, SAT_CONTRACT_REGIMES } from '@korporia/core';
import type { AppEnv } from '../../env';
import { requirePermission, resolveCompany } from '../../lib/auth';
import { DOCUMENT_COLUMNS, documentQuota, documentResponse, storeDocument } from '../../lib/documents';
import { str, UUID_RE } from '../../lib/input';
import { adminClient, audit, coreDb, rhDb } from '../../lib/supabase';
import { balanceFor, companyTimezone, DATE_RE, LEAVE_COLUMNS, loadEmployee, loadProfile, todayIn } from './shared';

/** Expediente de personal (EXP) y alta guiada (ONB). */
export const expedientes = new Hono<AppEnv>();

/**
 * GET /api/rh/employees → lista de expedientes con alertas:
 * documentos de ingreso que faltan, contrato o periodo de prueba por vencer (30 días).
 */
expedientes.get('/employees', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.expediente.ver');
  const admin = adminClient(c.env);
  const [{ data: employees }, { data: profiles }, { data: docs }, tz] = await Promise.all([
    coreDb(admin).from('employees').select('id, employee_number, full_name, position, active, hired_at, terminated_at').eq('company_id', companyId).order('full_name'),
    rhDb(admin).from('employee_profiles').select('employee_id, department_id, position_id, manager_id, contract_type, contract_end, probation_end').eq('company_id', companyId),
    rhDb(admin).from('documents').select('employee_id, kind').eq('company_id', companyId).is('deleted_at', null),
    companyTimezone(c.env, companyId),
  ]);
  const today = todayIn(tz);
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  const limit = soon.toISOString().slice(0, 10);
  const profileBy = new Map((profiles ?? []).map((p) => [p.employee_id, p]));
  const kindsBy = new Map<string, Set<string>>();
  for (const d of docs ?? []) {
    if (!kindsBy.has(d.employee_id)) kindsBy.set(d.employee_id, new Set());
    kindsBy.get(d.employee_id)!.add(d.kind);
  }
  return c.json({
    today,
    employees: (employees ?? []).map((e) => {
      const p = profileBy.get(e.id);
      const kinds = kindsBy.get(e.id) ?? new Set();
      const alerts: string[] = [];
      if (e.active && p?.contract_end && p.contract_end <= limit) alerts.push(p.contract_end < today ? 'contrato_vencido' : 'contrato_por_vencer');
      if (e.active && p?.probation_end && p.probation_end >= today && p.probation_end <= limit) alerts.push('prueba_por_terminar');
      return {
        ...e,
        department_id: p?.department_id ?? null,
        position_id: p?.position_id ?? null,
        manager_id: p?.manager_id ?? null,
        contract_type: p?.contract_type ?? null,
        contract_end: p?.contract_end ?? null,
        probation_end: p?.probation_end ?? null,
        missing_documents: ONBOARDING_DOCUMENTS.filter((k) => !kinds.has(k)),
        alerts,
      };
    }),
  });
});

/** GET /api/rh/employees/:id → expediente completo, documentos, saldo de vacaciones y ausencias. */
expedientes.get('/employees/:id', async (c) => {
  const auth = c.get('auth');
  const employee = await loadEmployee(c.env, c.req.param('id'));
  requirePermission(auth, employee.company_id, 'rh.expediente.ver');
  const admin = adminClient(c.env);
  const [profile, { data: documents }, { data: leaves }, tz, quota] = await Promise.all([
    loadProfile(c.env, employee.id),
    rhDb(admin).from('documents').select(DOCUMENT_COLUMNS).eq('employee_id', employee.id).is('deleted_at', null).order('created_at', { ascending: false }),
    rhDb(admin).from('leave_requests').select(LEAVE_COLUMNS).eq('employee_id', employee.id).order('start_date', { ascending: false }).limit(100),
    companyTimezone(c.env, employee.company_id),
    documentQuota(c.env, employee.company_id),
  ]);
  const today = todayIn(tz);
  const balance = await balanceFor(c.env, employee, today, Number(profile?.vacation_days_taken_before ?? 0));
  const kinds = new Set((documents ?? []).map((d) => d.kind));
  return c.json({
    employee,
    profile,
    documents: documents ?? [],
    missing_documents: ONBOARDING_DOCUMENTS.filter((k) => !kinds.has(k)),
    leaves: leaves ?? [],
    balance,
    quota,
    today,
  });
});

const dateOrNull = (v: unknown, label: string) => {
  const s = str(v, 10);
  if (s && !DATE_RE.test(s)) throw new HTTPException(400, { message: `Fecha inválida: ${label}.` });
  return s || null;
};

/**
 * PATCH /api/rh/employees/:id → datos del expediente (alta guiada y edición).
 * Campos de core.employees: email, national_id (CURP), tax_id (RFC), hired_at.
 * Campos de rh.employee_profiles: área, puesto, jefe, contrato, sueldo diario, datos personales.
 */
expedientes.patch('/employees/:id', async (c) => {
  const auth = c.get('auth');
  const employee = await loadEmployee(c.env, c.req.param('id'));
  requirePermission(auth, employee.company_id, 'rh.expediente.gestionar');
  const b = await c.req.json<Record<string, unknown>>();
  const admin = adminClient(c.env);
  const companyId = employee.company_id;

  const corePatch: Record<string, unknown> = {};
  if ('email' in b) {
    const e = str(b.email, 254).toLowerCase();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new HTTPException(400, { message: 'Correo inválido.' });
    corePatch.email = e || null;
  }
  if ('national_id' in b) {
    const v = str(b.national_id, 18).toUpperCase();
    if (v && !isValidCurp(v)) throw new HTTPException(400, { message: 'La CURP no es válida. Revisa los 18 caracteres.' });
    corePatch.national_id = v || null;
  }
  if ('tax_id' in b) {
    const v = str(b.tax_id, 13).toUpperCase();
    if (v && !isValidRfc(v)) throw new HTTPException(400, { message: 'El RFC no es válido (persona física, 13 caracteres).' });
    corePatch.tax_id = v || null;
  }
  if ('hired_at' in b) corePatch.hired_at = dateOrNull(b.hired_at, 'fecha de ingreso');

  const p: Record<string, unknown> = {};
  for (const [key, label] of [
    ['department_id', 'Área'],
    ['position_id', 'Puesto'],
    ['manager_id', 'Jefe directo'],
  ] as const) {
    if (key in b) {
      const v = str(b[key], 36);
      if (v && !UUID_RE.test(v)) throw new HTTPException(400, { message: `${label} inválido.` });
      p[key] = v || null;
    }
  }
  if (p.manager_id && p.manager_id === employee.id) throw new HTTPException(400, { message: 'Una persona no puede ser su propio jefe.' });
  if ('contract_type' in b) {
    const v = str(b.contract_type, 20);
    if (v && !(v in CONTRACT_TYPES)) throw new HTTPException(400, { message: 'Tipo de contrato inválido.' });
    p.contract_type = v || null;
  }
  if ('sat_regime' in b) {
    const v = str(b.sat_regime, 2);
    if (v && !(v in SAT_CONTRACT_REGIMES)) throw new HTTPException(400, { message: 'Régimen de contratación inválido.' });
    p.sat_regime = v || null;
  }
  if ('contract_start' in b) p.contract_start = dateOrNull(b.contract_start, 'inicio de contrato');
  if ('contract_end' in b) p.contract_end = dateOrNull(b.contract_end, 'fin de contrato');
  if ('probation_end' in b) p.probation_end = dateOrNull(b.probation_end, 'fin del periodo de prueba');
  if ('birth_date' in b) p.birth_date = dateOrNull(b.birth_date, 'fecha de nacimiento');
  if ('daily_salary' in b) {
    const v = b.daily_salary === '' || b.daily_salary == null ? null : Number(b.daily_salary);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100000)) throw new HTTPException(400, { message: 'Sueldo diario inválido.' });
    p.daily_salary = v;
  }
  if ('nss' in b) {
    const v = str(b.nss, 14).replace(/\D/g, '');
    if (v && !isValidNss(v)) throw new HTTPException(400, { message: 'El NSS no es válido (11 dígitos).' });
    p.nss = v || null;
  }
  for (const key of ['address', 'emergency_name', 'emergency_phone', 'beneficiaries'] as const) {
    if (key in b) p[key] = str(b[key], 500) || null;
  }
  if ('rest_days' in b) {
    const v = Array.isArray(b.rest_days) ? [...new Set(b.rest_days.map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : [];
    if (v.length === 0 || v.length > 3) throw new HTTPException(400, { message: 'Elige de 1 a 3 días de descanso.' });
    p.rest_days = v.sort();
  }
  if ('vacation_days_taken_before' in b) {
    const v = Number(b.vacation_days_taken_before);
    if (!Number.isFinite(v) || v < 0 || v > 1000) throw new HTTPException(400, { message: 'Días de vacaciones ya disfrutados inválidos.' });
    p.vacation_days_taken_before = v;
  }

  if (Object.keys(corePatch).length) {
    const { error } = await coreDb(admin).from('employees').update(corePatch).eq('id', employee.id);
    if (error) throw new HTTPException(500, { message: 'No se pudieron guardar los datos.' });
  }
  if (Object.keys(p).length) {
    const { error } = await rhDb(admin).from('employee_profiles').upsert({ employee_id: employee.id, company_id: companyId, ...p }, { onConflict: 'employee_id' });
    if (error) {
      if (error.code === '23503') throw new HTTPException(400, { message: 'El área, puesto o jefe no pertenece a la empresa.' });
      if (error.code === '23514') throw new HTTPException(400, { message: 'Revisa las fechas del contrato.' });
      console.error('profile upsert failed', error);
      throw new HTTPException(500, { message: 'No se pudo guardar el expediente.' });
    }
  }
  // Sin registrar valores sensibles en la bitácora: solo qué campos cambiaron
  await audit(c.env, {
    company_id: companyId,
    actor_id: auth.userId,
    action: 'rh.expediente.updated',
    entity: 'core.employees',
    entity_id: employee.id,
    details: { campos: [...Object.keys(corePatch), ...Object.keys(p)] },
  });
  return c.json({ employee: { ...employee, ...corePatch }, profile: await loadProfile(c.env, employee.id) });
});

/** POST /api/rh/employees/:id/documents (multipart: file, kind, expires_on?, name?) */
expedientes.post('/employees/:id/documents', async (c) => {
  const auth = c.get('auth');
  const employee = await loadEmployee(c.env, c.req.param('id'));
  requirePermission(auth, employee.company_id, 'rh.expediente.gestionar');
  const body = await c.req.parseBody();
  const doc = await storeDocument(c.env, {
    companyId: employee.company_id,
    employeeId: employee.id,
    kind: String(body.kind ?? ''),
    file: body.file,
    uploadedBy: auth.userId,
    byEmployee: false,
    expiresOn: typeof body.expires_on === 'string' ? body.expires_on : null,
    name: typeof body.name === 'string' ? body.name : undefined,
  });
  await audit(c.env, { company_id: employee.company_id, actor_id: auth.userId, action: 'rh.document.uploaded', entity: 'rh.documents', entity_id: doc.id, details: { kind: doc.kind } });
  return c.json({ document: doc }, 201);
});

/** GET /api/rh/employees/:id/documents/:docId → el archivo */
expedientes.get('/employees/:id/documents/:docId', async (c) => {
  const auth = c.get('auth');
  const { data: doc } = await rhDb(adminClient(c.env))
    .from('documents')
    .select('company_id, employee_id, path, mime, name')
    .eq('id', c.req.param('docId'))
    .eq('employee_id', c.req.param('id'))
    .is('deleted_at', null)
    .maybeSingle();
  if (!doc) throw new HTTPException(404, { message: 'Documento no encontrado.' });
  requirePermission(auth, doc.company_id, 'rh.expediente.ver');
  return documentResponse(c.env, doc.path, doc.mime, doc.name);
});

/** DELETE /api/rh/employees/:id/documents/:docId → borra el archivo (queda el registro del borrado). */
expedientes.delete('/employees/:id/documents/:docId', async (c) => {
  const auth = c.get('auth');
  const db = rhDb(adminClient(c.env));
  const { data: doc } = await db
    .from('documents')
    .select('id, company_id, path, kind')
    .eq('id', c.req.param('docId'))
    .eq('employee_id', c.req.param('id'))
    .is('deleted_at', null)
    .maybeSingle();
  if (!doc) throw new HTTPException(404, { message: 'Documento no encontrado.' });
  requirePermission(auth, doc.company_id, 'rh.expediente.gestionar');
  if (doc.kind === 'consentimiento') {
    throw new HTTPException(409, { message: 'El formato firmado es evidencia del consentimiento y no se puede borrar.' });
  }
  await db.from('documents').update({ deleted_at: new Date().toISOString(), deleted_by: auth.userId }).eq('id', doc.id);
  await c.env.FILES.delete(doc.path);
  await audit(c.env, { company_id: doc.company_id, actor_id: auth.userId, action: 'rh.document.deleted', entity: 'rh.documents', entity_id: doc.id, details: { kind: doc.kind } });
  return c.json({ ok: true });
});
