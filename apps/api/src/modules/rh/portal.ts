import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { LEAVE_KINDS, ONBOARDING_DOCUMENTS, type LeaveKind } from '@korporia/core';
import type { AppEnv } from '../../env';
import { requirePermission, resolveCompany } from '../../lib/auth';
import { DOCUMENT_COLUMNS, documentResponse, storeDocument } from '../../lib/documents';
import { str } from '../../lib/input';
import { adminClient, audit, coreDb, rhDb } from '../../lib/supabase';
import { balanceFor, companyTimezone, LEAVE_COLUMNS, loadProfile, prepareLeave, selfEmployee, todayIn } from './shared';

/** Portal del empleado (POR): sus datos, documentos y solicitudes. GET/POST /api/rh/me/… */
export const portal = new Hono<AppEnv>();

/** Documentos que el trabajador puede subir él mismo. */
const SELF_KINDS = new Set<string>([...ONBOARDING_DOCUMENTS, 'estudios', 'incapacidad', 'licencia', 'certificacion']);

portal.get('/me', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.portal.ver');
  const employee = await selfEmployee(c.env, companyId, auth.userId);
  const admin = adminClient(c.env);
  const [profile, { data: documents }, { data: leaves }, tz] = await Promise.all([
    loadProfile(c.env, employee.id),
    rhDb(admin).from('documents').select(DOCUMENT_COLUMNS).eq('employee_id', employee.id).is('deleted_at', null).order('created_at', { ascending: false }),
    rhDb(admin).from('leave_requests').select(LEAVE_COLUMNS).eq('employee_id', employee.id).order('start_date', { ascending: false }).limit(50),
    companyTimezone(c.env, companyId),
  ]);
  const today = todayIn(tz);
  const [balance, names] = await Promise.all([
    balanceFor(c.env, employee, today, Number(profile?.vacation_days_taken_before ?? 0)),
    (async () => {
      const ids = [profile?.department_id, profile?.position_id].filter(Boolean) as string[];
      if (!ids.length && !profile?.manager_id) return {};
      const [{ data: dep }, { data: pos }, { data: boss }] = await Promise.all([
        profile?.department_id ? rhDb(admin).from('departments').select('name').eq('id', profile.department_id).maybeSingle() : Promise.resolve({ data: null }),
        profile?.position_id ? rhDb(admin).from('positions').select('name').eq('id', profile.position_id).maybeSingle() : Promise.resolve({ data: null }),
        profile?.manager_id ? coreDb(admin).from('employees').select('full_name').eq('id', profile.manager_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      return { department: dep?.name ?? null, position: pos?.name ?? null, manager: boss?.full_name ?? null };
    })(),
  ]);
  const kinds = new Set((documents ?? []).map((d) => d.kind));
  return c.json({
    employee: {
      full_name: employee.full_name,
      employee_number: employee.employee_number,
      phone: employee.phone,
      email: employee.email,
      national_id: employee.national_id,
      tax_id: employee.tax_id,
      hired_at: employee.hired_at,
    },
    profile: profile
      ? {
          contract_type: profile.contract_type,
          contract_start: profile.contract_start,
          contract_end: profile.contract_end,
          nss: profile.nss,
          address: profile.address,
          emergency_name: profile.emergency_name,
          emergency_phone: profile.emergency_phone,
          rest_days: profile.rest_days,
        }
      : null,
    org: names,
    documents: documents ?? [],
    missing_documents: ONBOARDING_DOCUMENTS.filter((k) => !kinds.has(k)),
    leaves: leaves ?? [],
    balance,
    today,
  });
});

/** El trabajador actualiza sus datos de contacto y de emergencia. PATCH /api/rh/me */
portal.patch('/me', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.portal.solicitar');
  const employee = await selfEmployee(c.env, companyId, auth.userId);
  const b = await c.req.json<Record<string, unknown>>();
  const p: Record<string, unknown> = {};
  for (const key of ['address', 'emergency_name', 'emergency_phone'] as const) if (key in b) p[key] = str(b[key], 300) || null;
  if (!Object.keys(p).length) throw new HTTPException(400, { message: 'Nada que guardar.' });
  const { error } = await rhDb(adminClient(c.env)).from('employee_profiles').upsert({ employee_id: employee.id, company_id: companyId, ...p }, { onConflict: 'employee_id' });
  if (error) throw new HTTPException(500, { message: 'No se pudieron guardar tus datos.' });
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: 'rh.portal.updated', entity: 'core.employees', entity_id: employee.id, details: { campos: Object.keys(p) } });
  return c.json({ ok: true });
});

/** POST /api/rh/me/leaves { kind, start_date, end_date, reason? } → solicitud pendiente de aprobar */
portal.post('/me/leaves', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.portal.solicitar');
  const employee = await selfEmployee(c.env, companyId, auth.userId);
  const b = await c.req.json<Record<string, unknown>>();
  const kind = str(b.kind, 30) as LeaveKind;
  if (!(kind in LEAVE_KINDS) || !LEAVE_KINDS[kind].byEmployee || kind === 'incapacidad') {
    throw new HTTPException(400, { message: 'Desde aquí puedes pedir vacaciones y permisos. Las incapacidades y licencias las registra tu empresa.' });
  }
  const [profile, tz] = await Promise.all([loadProfile(c.env, employee.id), companyTimezone(c.env, companyId)]);
  const today = todayIn(tz);
  const start = str(b.start_date, 10);
  const end = str(b.end_date, 10);
  if (start < today) throw new HTTPException(400, { message: 'Las fechas deben ser de hoy en adelante.' });
  const days = await prepareLeave(c.env, employee, { kind, start, end }, {
    today,
    restDays: profile?.rest_days ?? [7],
    takenBefore: Number(profile?.vacation_days_taken_before ?? 0),
  });
  const { data, error } = await rhDb(adminClient(c.env))
    .from('leave_requests')
    .insert({
      company_id: companyId,
      employee_id: employee.id,
      kind,
      start_date: start,
      end_date: end,
      days,
      reason: str(b.reason, 500) || null,
      requested_by: auth.userId,
      by_employee: true,
    })
    .select(LEAVE_COLUMNS)
    .single();
  if (error) throw new HTTPException(500, { message: 'No se pudo enviar tu solicitud.' });
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: 'rh.leave.requested', entity: 'rh.leave_requests', entity_id: data.id, details: { kind, start, end, days } });
  return c.json({ leave: data }, 201);
});

/** POST /api/rh/me/leaves/:id/cancel → solo mientras siga pendiente */
portal.post('/me/leaves/:id/cancel', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.portal.solicitar');
  const employee = await selfEmployee(c.env, companyId, auth.userId);
  const { data, error } = await rhDb(adminClient(c.env))
    .from('leave_requests')
    .update({ status: 'cancelada', decided_by: auth.userId, decided_at: new Date().toISOString() })
    .eq('id', c.req.param('id'))
    .eq('employee_id', employee.id)
    .eq('status', 'pendiente')
    .select(LEAVE_COLUMNS)
    .maybeSingle();
  if (error || !data) throw new HTTPException(409, { message: 'Solo puedes cancelar solicitudes pendientes.' });
  return c.json({ leave: data });
});

/** POST /api/rh/me/documents (multipart: file, kind) → el trabajador sube sus documentos desde el celular */
portal.post('/me/documents', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.portal.solicitar');
  const employee = await selfEmployee(c.env, companyId, auth.userId);
  const body = await c.req.parseBody();
  const kind = String(body.kind ?? '');
  if (!SELF_KINDS.has(kind)) throw new HTTPException(400, { message: 'Ese tipo de documento lo carga tu empresa.' });
  const doc = await storeDocument(c.env, { companyId, employeeId: employee.id, kind, file: body.file, uploadedBy: auth.userId, byEmployee: true });
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: 'rh.document.uploaded_by_employee', entity: 'rh.documents', entity_id: doc.id, details: { kind } });
  return c.json({ document: doc }, 201);
});

/** GET /api/rh/me/documents/:docId → su propio archivo */
portal.get('/me/documents/:docId', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.portal.ver');
  const employee = await selfEmployee(c.env, companyId, auth.userId);
  const { data: doc } = await rhDb(adminClient(c.env))
    .from('documents')
    .select('path, mime, name')
    .eq('id', c.req.param('docId'))
    .eq('employee_id', employee.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!doc) throw new HTTPException(404, { message: 'Documento no encontrado.' });
  return documentResponse(c.env, doc.path, doc.mime, doc.name);
});
