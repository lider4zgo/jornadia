import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { INCAPACITY_TYPES, LEAVE_KINDS, type LeaveKind } from '@korporia/core';
import type { AppEnv } from '../../env';
import { requirePermission, resolveCompany } from '../../lib/auth';
import { str, UUID_RE } from '../../lib/input';
import { adminClient, audit, coreDb, rhDb } from '../../lib/supabase';
import { companyTimezone, DATE_RE, LEAVE_COLUMNS, loadEmployee, loadProfile, prepareLeave, todayIn } from './shared';

/** Vacaciones, permisos, licencias e incapacidades (VAC). Las aprueba el administrador. */
export const leaves = new Hono<AppEnv>();

/** GET /api/rh/leaves?status=pendiente&from=&to= → ausencias de la empresa con el nombre del colaborador. */
leaves.get('/leaves', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.ausencias.ver');
  const admin = adminClient(c.env);
  let q = rhDb(admin).from('leave_requests').select(LEAVE_COLUMNS).eq('company_id', companyId).order('start_date', { ascending: false }).limit(300);
  const status = c.req.query('status');
  if (status && ['pendiente', 'aprobada', 'rechazada', 'cancelada'].includes(status)) q = q.eq('status', status);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (from && DATE_RE.test(from)) q = q.gte('end_date', from);
  if (to && DATE_RE.test(to)) q = q.lte('start_date', to);
  const [{ data }, { data: employees }] = await Promise.all([
    q,
    coreDb(admin).from('employees').select('id, full_name, employee_number').eq('company_id', companyId),
  ]);
  const names = new Map((employees ?? []).map((e) => [e.id, e]));
  return c.json({ leaves: (data ?? []).map((l) => ({ ...l, employee: names.get(l.employee_id) ?? null })) });
});

/**
 * El administrador registra una ausencia (incluye incapacidades y licencias), ya aprobada.
 * POST /api/rh/leaves { employee_id, kind, start_date, end_date, reason?, imss_folio?, incapacity_type?, document_id? }
 */
leaves.post('/leaves', async (c) => {
  const auth = c.get('auth');
  const b = await c.req.json<Record<string, unknown>>();
  const employeeId = str(b.employee_id, 36);
  if (!UUID_RE.test(employeeId)) throw new HTTPException(400, { message: 'Colaborador inválido.' });
  const employee = await loadEmployee(c.env, employeeId);
  requirePermission(auth, employee.company_id, 'rh.ausencias.aprobar');
  const kind = str(b.kind, 30) as LeaveKind;
  if (!(kind in LEAVE_KINDS)) throw new HTTPException(400, { message: 'Tipo de ausencia inválido.' });
  const incapacityType = str(b.incapacity_type, 30);
  if (kind === 'incapacidad' && !(incapacityType in INCAPACITY_TYPES)) throw new HTTPException(400, { message: 'Indica el tipo de incapacidad.' });
  const documentId = str(b.document_id, 36);
  if (documentId && !UUID_RE.test(documentId)) throw new HTTPException(400, { message: 'Documento inválido.' });

  const [profile, tz] = await Promise.all([loadProfile(c.env, employee.id), companyTimezone(c.env, employee.company_id)]);
  const start = str(b.start_date, 10);
  const end = str(b.end_date, 10);
  const days = await prepareLeave(c.env, employee, { kind, start, end }, {
    today: todayIn(tz),
    restDays: profile?.rest_days ?? [7],
    takenBefore: Number(profile?.vacation_days_taken_before ?? 0),
  });
  const { data, error } = await rhDb(adminClient(c.env))
    .from('leave_requests')
    .insert({
      company_id: employee.company_id,
      employee_id: employee.id,
      kind,
      start_date: start,
      end_date: end,
      days,
      reason: str(b.reason, 500) || null,
      status: 'aprobada',
      imss_folio: kind === 'incapacidad' ? str(b.imss_folio, 30) || null : null,
      incapacity_type: kind === 'incapacidad' ? incapacityType : null,
      document_id: documentId || null,
      requested_by: auth.userId,
      decided_by: auth.userId,
      decided_at: new Date().toISOString(),
    })
    .select(LEAVE_COLUMNS)
    .single();
  if (error) {
    console.error('leave insert failed', error);
    throw new HTTPException(500, { message: 'No se pudo registrar la ausencia.' });
  }
  await audit(c.env, { company_id: employee.company_id, actor_id: auth.userId, action: 'rh.leave.recorded', entity: 'rh.leave_requests', entity_id: data.id, details: { kind, start, end, days } });
  return c.json({ leave: data }, 201);
});

/** POST /api/rh/leaves/:id/decision { decision: 'aprobada'|'rechazada'|'cancelada', note? } */
leaves.post('/leaves/:id/decision', async (c) => {
  const auth = c.get('auth');
  const db = rhDb(adminClient(c.env));
  const { data: leave } = await db.from('leave_requests').select('*').eq('id', c.req.param('id')).maybeSingle();
  if (!leave) throw new HTTPException(404, { message: 'Solicitud no encontrada.' });
  requirePermission(auth, leave.company_id, 'rh.ausencias.aprobar');
  const b = await c.req.json<Record<string, unknown>>();
  const decision = str(b.decision, 12);
  if (!['aprobada', 'rechazada', 'cancelada'].includes(decision)) throw new HTTPException(400, { message: 'Decisión inválida.' });
  if (decision === 'cancelada' ? leave.status === 'cancelada' : leave.status !== 'pendiente') {
    throw new HTTPException(409, { message: 'Esta solicitud ya fue resuelta.' });
  }
  const { data, error } = await db
    .from('leave_requests')
    .update({ status: decision, decided_by: auth.userId, decided_at: new Date().toISOString(), decision_note: str(b.note, 500) || null })
    .eq('id', leave.id)
    .eq('status', leave.status)
    .select(LEAVE_COLUMNS)
    .single();
  if (error || !data) throw new HTTPException(409, { message: 'La solicitud cambió mientras tanto. Recarga e intenta de nuevo.' });
  await audit(c.env, { company_id: leave.company_id, actor_id: auth.userId, action: `rh.leave.${decision}`, entity: 'rh.leave_requests', entity_id: leave.id });
  return c.json({ leave: data });
});
