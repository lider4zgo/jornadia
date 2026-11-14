import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { parseScheduleDays, scheduleErrors, type ScheduleDay } from '@korporia/jornada';
import type { AppEnv } from '../../env';
import { requireAuth, requirePermission, resolveCompany } from '../../lib/auth';
import { str, UUID_RE } from '../../lib/input';
import { adminClient, audit, coreDb, jornadaDb, rhDb } from '../../lib/supabase';

/**
 * JOR-10: horarios de trabajo (horas por día) y su asignación.
 *   GET    /api/jornada/schedules            horarios, personal activo con su horario, áreas
 *   POST   /api/jornada/schedules            { name, days, tolerance_minutes }
 *   PATCH  /api/jornada/schedules/:id        { name?, days?, tolerance_minutes? }
 *   DELETE /api/jornada/schedules/:id        lo desactiva y lo quita a quien lo tenía
 *   POST   /api/jornada/schedules/assign     { schedule_id | null, employee_ids }
 * Los límites de la LFT solo se avisan (en la pantalla); aquí se valida la forma.
 */
export const schedules = new Hono<AppEnv>();
schedules.use('*', requireAuth);

function readDays(raw: unknown): ScheduleDay[] {
  if (!Array.isArray(raw) || raw.length > 7) throw new HTTPException(400, { message: 'Revisa los días del horario.' });
  const days = raw.map((d) => {
    const r = (d ?? {}) as Record<string, unknown>;
    return { weekday: Number(r.weekday), start: str(r.start, 5), end: str(r.end, 5), breakMinutes: Number(r.breakMinutes ?? 0) };
  });
  const errors = scheduleErrors(days);
  if (errors.length) throw new HTTPException(400, { message: errors[0] });
  return days.sort((a, b) => a.weekday - b.weekday);
}

function readTolerance(raw: unknown): number {
  const n = Number(raw ?? 10);
  if (!Number.isInteger(n) || n < 0 || n > 120) throw new HTTPException(400, { message: 'La tolerancia debe ser de 0 a 120 minutos.' });
  return n;
}

function readName(raw: unknown): string {
  const name = str(raw, 60);
  if (name.length < 2) throw new HTTPException(400, { message: 'Escribe el nombre del horario.' });
  return name;
}

const duplicate = (error: { code?: string } | null) => error?.code === '23505';

schedules.get('/', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'jornada.configurar', 'core.personal.ver');
  const admin = adminClient(c.env);
  const [{ data: list }, { data: employees }, { data: settings }, { data: profiles }, { data: departments }] = await Promise.all([
    jornadaDb(admin).from('schedules').select('id, name, days, tolerance_minutes, updated_at').eq('company_id', companyId).eq('active', true).order('name'),
    coreDb(admin).from('employees').select('id, employee_number, full_name, position, default_site_id').eq('company_id', companyId).eq('active', true).order('employee_number'),
    jornadaDb(admin).from('employee_settings').select('employee_id, schedule_id').eq('company_id', companyId),
    rhDb(admin).from('employee_profiles').select('employee_id, department_id').eq('company_id', companyId),
    rhDb(admin).from('departments').select('id, name').eq('company_id', companyId).eq('active', true).order('name'),
  ]);
  const scheduleOf = new Map((settings ?? []).map((s) => [s.employee_id, s.schedule_id as string | null]));
  const departmentOf = new Map((profiles ?? []).map((p) => [p.employee_id, p.department_id as string | null]));
  const people = (employees ?? []).map((e) => ({
    ...e,
    schedule_id: scheduleOf.get(e.id) ?? null,
    department_id: departmentOf.get(e.id) ?? null,
  }));
  return c.json({
    schedules: (list ?? []).map((s) => ({ ...s, days: parseScheduleDays(s.days), assigned: people.filter((p) => p.schedule_id === s.id).length })),
    employees: people,
    departments: departments ?? [],
  });
});

schedules.post('/', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'jornada.configurar');
  const b = await c.req.json<Record<string, unknown>>();
  const row = { company_id: companyId, name: readName(b.name), days: readDays(b.days), tolerance_minutes: readTolerance(b.tolerance_minutes) };
  const { data, error } = await jornadaDb(adminClient(c.env)).from('schedules').insert(row).select('id').single();
  if (duplicate(error)) throw new HTTPException(409, { message: 'Ya tienes un horario con ese nombre.' });
  if (error || !data) throw new HTTPException(500, { message: 'No se pudo guardar el horario.' });
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: 'jornada.schedule.created', entity: 'jornada.schedules', entity_id: data.id, details: { name: row.name, days: row.days } });
  return c.json({ id: data.id }, 201);
});

schedules.post('/assign', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'jornada.configurar');
  const b = await c.req.json<{ schedule_id?: unknown; employee_ids?: unknown }>();
  const scheduleId = b.schedule_id == null || b.schedule_id === '' ? null : String(b.schedule_id);
  const ids = Array.isArray(b.employee_ids) ? [...new Set(b.employee_ids.map(String))] : [];
  if (!ids.length || ids.length > 2000 || ids.some((id) => !UUID_RE.test(id))) throw new HTTPException(400, { message: 'Elige a quién asignar el horario.' });
  if (scheduleId && !UUID_RE.test(scheduleId)) throw new HTTPException(400, { message: 'Horario inválido.' });

  const admin = adminClient(c.env);
  if (scheduleId) {
    const { data: s } = await jornadaDb(admin).from('schedules').select('id').eq('id', scheduleId).eq('company_id', companyId).eq('active', true).maybeSingle();
    if (!s) throw new HTTPException(404, { message: 'Ese horario ya no existe.' });
  }
  const { data: valid } = await coreDb(admin).from('employees').select('id').eq('company_id', companyId).in('id', ids);
  const employeeIds = (valid ?? []).map((e) => e.id as string);
  if (employeeIds.length !== ids.length) throw new HTTPException(400, { message: 'Alguna de las personas no es de tu empresa.' });

  const { error } = await jornadaDb(admin)
    .from('employee_settings')
    .upsert(
      employeeIds.map((employee_id) => ({ employee_id, company_id: companyId, schedule_id: scheduleId })),
      { onConflict: 'employee_id' },
    );
  if (error) {
    console.error('schedule assign failed', error);
    throw new HTTPException(500, { message: 'No se pudo asignar el horario.' });
  }
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: 'jornada.schedule.assigned', entity: 'jornada.employee_settings', entity_id: scheduleId, details: { employees: employeeIds.length } });
  return c.json({ ok: true, assigned: employeeIds.length });
});

schedules.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'jornada.configurar');
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HTTPException(400, { message: 'Horario inválido.' });
  const b = await c.req.json<Record<string, unknown>>();
  const row: Record<string, unknown> = {};
  if ('name' in b) row.name = readName(b.name);
  if ('days' in b) row.days = readDays(b.days);
  if ('tolerance_minutes' in b) row.tolerance_minutes = readTolerance(b.tolerance_minutes);
  if (!Object.keys(row).length) return c.json({ ok: true });
  const { data, error } = await jornadaDb(adminClient(c.env)).from('schedules').update(row).eq('id', id).eq('company_id', companyId).eq('active', true).select('id');
  if (duplicate(error)) throw new HTTPException(409, { message: 'Ya tienes un horario con ese nombre.' });
  if (error) throw new HTTPException(500, { message: 'No se pudo guardar el horario.' });
  if (!data?.length) throw new HTTPException(404, { message: 'Ese horario ya no existe.' });
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: 'jornada.schedule.updated', entity: 'jornada.schedules', entity_id: id, details: row });
  return c.json({ ok: true });
});

schedules.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'jornada.configurar');
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HTTPException(400, { message: 'Horario inválido.' });
  const admin = adminClient(c.env);
  const { data } = await jornadaDb(admin).from('schedules').update({ active: false }).eq('id', id).eq('company_id', companyId).eq('active', true).select('id, name');
  if (!data?.length) throw new HTTPException(404, { message: 'Ese horario ya no existe.' });
  await jornadaDb(admin).from('employee_settings').update({ schedule_id: null }).eq('company_id', companyId).eq('schedule_id', id);
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: 'jornada.schedule.removed', entity: 'jornada.schedules', entity_id: id, details: { name: data[0]?.name ?? null } });
  return c.json({ ok: true });
});
