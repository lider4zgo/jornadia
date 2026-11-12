import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../../env';
import { requirePermission, resolveCompany } from '../../lib/auth';
import { str, UUID_RE } from '../../lib/input';
import { adminClient, audit, coreDb, rhDb } from '../../lib/supabase';

/** Áreas, puestos, jefe directo y organigrama (ORG). */
export const structure = new Hono<AppEnv>();

/** GET /api/rh/structure → áreas, puestos y colaboradores activos con su jefe (para el organigrama). */
structure.get('/structure', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.expediente.ver', 'rh.estructura.gestionar', 'core.personal.ver');
  const admin = adminClient(c.env);
  const [{ data: departments }, { data: positions }, { data: employees }, { data: profiles }] = await Promise.all([
    rhDb(admin).from('departments').select('id, name, active').eq('company_id', companyId).order('name'),
    rhDb(admin).from('positions').select('id, name, description, department_id, active').eq('company_id', companyId).order('name'),
    coreDb(admin).from('employees').select('id, full_name, employee_number, position').eq('company_id', companyId).eq('active', true).order('full_name'),
    rhDb(admin).from('employee_profiles').select('employee_id, department_id, position_id, manager_id').eq('company_id', companyId),
  ]);
  const byId = new Map((profiles ?? []).map((p) => [p.employee_id, p]));
  return c.json({
    departments: departments ?? [],
    positions: positions ?? [],
    people: (employees ?? []).map((e) => ({
      ...e,
      department_id: byId.get(e.id)?.department_id ?? null,
      position_id: byId.get(e.id)?.position_id ?? null,
      manager_id: byId.get(e.id)?.manager_id ?? null,
    })),
  });
});

async function save(table: 'departments' | 'positions', c: Context<AppEnv>, id?: string) {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.estructura.gestionar');
  const b = await c.req.json<Record<string, unknown>>();
  const row: Record<string, unknown> = {};
  if (!id || 'name' in b) {
    const name = str(b.name, 80);
    if (!name) throw new HTTPException(400, { message: 'Escribe el nombre.' });
    row.name = name;
  }
  if ('active' in b && typeof b.active === 'boolean') row.active = b.active;
  if (table === 'positions') {
    if ('description' in b) row.description = str(b.description, 1000) || null;
    if ('department_id' in b) {
      const d = str(b.department_id, 36);
      if (d && !UUID_RE.test(d)) throw new HTTPException(400, { message: 'Área inválida.' });
      row.department_id = d || null;
    }
  }
  const db = rhDb(adminClient(c.env));
  const q = id ? db.from(table).update(row).eq('id', id).eq('company_id', companyId) : db.from(table).insert({ ...row, company_id: companyId });
  const { data, error } = await q.select('*').single();
  if (error) {
    if (error.code === '23505') throw new HTTPException(409, { message: 'Ya existe uno con ese nombre.' });
    if (error.code === '23503') throw new HTTPException(400, { message: 'El área no pertenece a la empresa.' });
    if (error.code === 'PGRST116') throw new HTTPException(404, { message: 'No encontrado.' });
    console.error(`${table} save failed`, error);
    throw new HTTPException(500, { message: 'No se pudo guardar.' });
  }
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: `rh.${table}.${id ? 'updated' : 'created'}`, entity: `rh.${table}`, entity_id: data.id, details: row });
  return c.json({ item: data }, id ? 200 : 201);
}

structure.post('/departments', (c) => save('departments', c));
structure.patch('/departments/:id', (c) => save('departments', c, c.req.param('id')));
structure.post('/positions', (c) => save('positions', c));
structure.patch('/positions/:id', (c) => save('positions', c, c.req.param('id')));
