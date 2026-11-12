import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { invalidateAccess, requireAuth, requirePermission } from '../lib/auth';
import { str, UUID_RE } from '../lib/input';
import { adminClient, audit, coreDb } from '../lib/supabase';

export const employees = new Hono<AppEnv>();
employees.use('*', requireAuth);

const EDITABLE = ['employee_number', 'full_name', 'phone', 'position', 'default_site_id'] as const;

/** Fecha de hoy en la zona horaria de la empresa (AAAA-MM-DD). */
function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * Edita el expediente básico de un colaborador, o lo da de baja / reactiva.
 * PATCH /api/core/employees/:id { employee_number?, full_name?, phone?, position?, default_site_id?, active? }
 *
 * - Dar de baja desactiva también su acceso (membresía); sus registros se conservan.
 * - Reactivar respeta el límite de colaboradores activos del plan.
 * - Cambiar el número de empleado no afecta su acceso: la cuenta usa un correo interno fijo.
 */
employees.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HTTPException(400, { message: 'Colaborador inválido.' });

  const core = coreDb(adminClient(c.env));
  const { data: current } = await core
    .from('employees')
    .select('id, company_id, user_id, employee_number, full_name, phone, position, default_site_id, active')
    .eq('id', id)
    .maybeSingle();
  if (!current) throw new HTTPException(404, { message: 'Colaborador no encontrado.' });
  requirePermission(auth, current.company_id, 'core.personal.gestionar');

  const b = await c.req.json<Record<string, unknown>>();
  const patch: Record<string, unknown> = {};

  if ('employee_number' in b) {
    const n = str(b.employee_number, 20);
    if (!n || !/^[A-Za-z0-9-]+$/.test(n)) throw new HTTPException(400, { message: 'El número de empleado solo admite letras, números o guion.' });
    patch.employee_number = n;
  }
  if ('full_name' in b) {
    const n = str(b.full_name);
    if (!n) throw new HTTPException(400, { message: 'El nombre es obligatorio.' });
    patch.full_name = n;
  }
  if ('phone' in b) {
    const p = str(b.phone, 20).replace(/[^\d+]/g, '');
    if (p && (p.replace(/\D/g, '').length < 10 || p.replace(/\D/g, '').length > 13)) {
      throw new HTTPException(400, { message: 'El celular debe tener 10 dígitos (o incluir la clave de país).' });
    }
    patch.phone = p || null;
  }
  if ('position' in b) patch.position = str(b.position, 80) || null;
  if ('default_site_id' in b) {
    const s = str(b.default_site_id, 36);
    if (s && !UUID_RE.test(s)) throw new HTTPException(400, { message: 'Obra inválida.' });
    if (s) {
      const { data: site } = await core.from('sites').select('id').eq('id', s).eq('company_id', current.company_id).maybeSingle();
      if (!site) throw new HTTPException(400, { message: 'La obra no pertenece a la empresa.' });
    }
    patch.default_site_id = s || null;
  }

  let statusChange: 'terminated' | 'reactivated' | null = null;
  if ('active' in b && typeof b.active === 'boolean' && b.active !== current.active) {
    if (b.active) {
      const [{ data: subscription }, { count }] = await Promise.all([
        core.from('subscriptions').select('employee_limit').eq('company_id', current.company_id).single(),
        core.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', current.company_id).eq('active', true),
      ]);
      if (subscription && (count ?? 0) >= subscription.employee_limit) {
        throw new HTTPException(402, {
          message: `Tu plan permite ${subscription.employee_limit} colaboradores activos. Da de baja a otro o cambia de paquete para reactivarlo.`,
        });
      }
      patch.active = true;
      patch.terminated_at = null;
      statusChange = 'reactivated';
    } else {
      const { data: company } = await core.from('companies').select('timezone').eq('id', current.company_id).single();
      patch.active = false;
      patch.terminated_at = todayIn(company?.timezone ?? 'America/Mexico_City');
      statusChange = 'terminated';
    }
  }

  if (Object.keys(patch).length === 0) return c.json({ employee: current });

  const { data: updated, error } = await core
    .from('employees')
    .update(patch)
    .eq('id', id)
    .select('id, employee_number, full_name, phone, position, default_site_id, active, terminated_at')
    .single();
  if (error) {
    if (error.code === '23505') throw new HTTPException(409, { message: 'Ese número de empleado ya existe.' });
    console.error('employee update failed', error);
    throw new HTTPException(500, { message: 'No se pudieron guardar los cambios.' });
  }

  // La baja apaga su acceso; la reactivación lo devuelve
  if (statusChange && current.user_id) {
    await core.from('memberships').update({ active: statusChange === 'reactivated' }).eq('company_id', current.company_id).eq('user_id', current.user_id);
    invalidateAccess(current.user_id);
  }

  const changed = Object.fromEntries(
    EDITABLE.filter((k) => k in patch && patch[k] !== (current as Record<string, unknown>)[k]).map((k) => [
      k,
      { antes: (current as Record<string, unknown>)[k], despues: patch[k] },
    ]),
  );
  await audit(c.env, {
    company_id: current.company_id,
    actor_id: auth.userId,
    action: statusChange ? `employee.${statusChange}` : 'employee.updated',
    entity: 'core.employees',
    entity_id: id,
    details: { cambios: changed },
  });

  return c.json({ employee: updated });
});
