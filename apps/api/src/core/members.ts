import { requireRecentCode } from './device';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { canGrantRole } from '@korporia/core';
import type { AppEnv } from '../env';
import { accessFor, requireAuth, requirePermission } from '../lib/auth';
import { EMAIL_RE, str, UUID_RE } from '../lib/input';
import { adminClient, audit, coreDb } from '../lib/supabase';
import { createWorkerAccount } from './workers';

export const members = new Hono<AppEnv>();
members.use('*', requireAuth);

/**
 * Da de alta a una persona con un rol.
 *  - role 'worker' (por defecto): colaborador que entra con código de empresa + número
 *    de empleado; se crea su expediente en core.employees.
 *  - cualquier otro rol (supervisor, admin o uno propio de la empresa): cuenta con correo
 *    y contraseña.
 * Nadie puede otorgar un rol con permisos que no tiene (ver canGrantRole).
 *
 * POST /api/core/members { company_id, role?, employee_number?, full_name, email?, password?,
 *                          phone?, position?, default_site_id?, site_ids?, consent_confirmed? }
 */
members.post('/', async (c) => {
  const auth = c.get('auth');
  const b = await c.req.json<Record<string, unknown>>();
  const companyId = str(b.company_id, 36);
  if (!UUID_RE.test(companyId)) throw new HTTPException(400, { message: 'Empresa inválida.' });
  const roleKey = str(b.role, 32) || 'worker';
  const isWorker = roleKey === 'worker';
  requirePermission(auth, companyId, isWorker ? 'core.personal.gestionar' : 'core.usuarios.gestionar');
  // Dar acceso de administración es un cambio sensible: pide un código reciente del correo
  if (!isWorker) await requireRecentCode(c);

  const admin = adminClient(c.env);
  const core = coreDb(admin);

  // Rol del sistema o propio de la empresa, y sus permisos
  const { data: roles } = await core
    .from('roles')
    .select('id, key, company_id, role_permissions(permission_key)')
    .eq('key', roleKey)
    .or(`company_id.is.null,company_id.eq.${companyId}`);
  const role = (roles ?? []).sort((a, b) => (a.company_id ? 0 : 1) - (b.company_id ? 0 : 1))[0];
  if (!role || role.key === 'owner') throw new HTTPException(400, { message: 'Rol inválido.' });
  const rolePermissions = (role.role_permissions as { permission_key: string }[]).map((p) => p.permission_key);
  const actor = accessFor(auth, companyId);
  if (!auth.isPlatformAdmin && !canGrantRole(actor?.permissions ?? [], rolePermissions)) {
    throw new HTTPException(403, { message: 'No puedes otorgar un rol con los mismos o más permisos que el tuyo.' });
  }

  const employeeNumber = str(b.employee_number, 20);
  const fullName = str(b.full_name);
  if (!fullName) throw new HTTPException(400, { message: 'El nombre es obligatorio.' });
  if (isWorker && (!employeeNumber || !/^[A-Za-z0-9-]+$/.test(employeeNumber))) {
    throw new HTTPException(400, { message: 'El número de empleado (letras, números o guion) es obligatorio.' });
  }

  const [{ data: company }, { data: subscription }, { data: companyModules }] = await Promise.all([
    core.from('companies').select('id, code').eq('id', companyId).single(),
    core.from('subscriptions').select('employee_limit, admin_limit').eq('company_id', companyId).single(),
    core.from('company_modules').select('module_key').eq('company_id', companyId).eq('active', true),
  ]);
  if (!company || !subscription) throw new HTTPException(404, { message: 'Empresa no encontrada.' });

  if (isWorker) {
    const { count } = await core.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('active', true);
    if ((count ?? 0) >= subscription.employee_limit) {
      throw new HTTPException(402, {
        message: `Tu plan permite ${subscription.employee_limit} colaboradores activos. Cambia de paquete para agregar más.`,
      });
    }
  }

  // Usuarios de gestión (todos menos colaboradores): Korporia Starter permite solo 1 administrador
  if (!isWorker && subscription.admin_limit) {
    const { data: managers } = await core
      .from('memberships')
      .select('id, roles!inner(key)')
      .eq('company_id', companyId)
      .eq('active', true)
      .neq('roles.key', 'worker');
    if ((managers ?? []).length >= subscription.admin_limit) {
      throw new HTTPException(402, {
        message:
          subscription.admin_limit === 1
            ? 'Korporia Starter incluye 1 administrador. Contrata Jornada para dar acceso a supervisores y más administradores.'
            : `Tu plan permite ${subscription.admin_limit} usuarios de administración.`,
      });
    }
  }

  let employee: { id: string; employee_number: string; full_name: string } | null = null;
  let membershipId: string;
  if (isWorker) {
    // El colaborador no usa contraseña: entra con código de empresa + número + su PIN
    const created = await createWorkerAccount(c.env, {
      actorId: auth.userId,
      companyId,
      companyCode: company.code,
      roleId: role.id,
      activeModules: new Set((companyModules ?? []).map((m) => m.module_key as string)),
      worker: {
        employee_number: employeeNumber,
        full_name: fullName,
        phone: str(b.phone, 20) || null,
        position: str(b.position, 80) || null,
        default_site_id: str(b.default_site_id, 36) || null,
      },
      body: b,
    });
    employee = created.employee;
    membershipId = created.membershipId;
  } else {
    const email = str(b.email).toLowerCase();
    const password = typeof b.password === 'string' ? b.password : '';
    if (!EMAIL_RE.test(email) || password.length < 8) throw new HTTPException(400, { message: 'Correo o contraseña inválidos (mínimo 8 caracteres).' });
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, company_id: companyId },
    });
    if (created.error || !created.data.user) {
      const msg = created.error?.message?.includes('already') ? 'Ya existe una cuenta con ese número o correo.' : 'No se pudo crear la cuenta.';
      throw new HTTPException(409, { message: msg });
    }
    const userId = created.data.user.id;
    const { data: membership, error: mErr } = await core
      .from('memberships')
      .insert({ company_id: companyId, user_id: userId, role_id: role.id })
      .select('id')
      .single();
    if (mErr || !membership) {
      await admin.auth.admin.deleteUser(userId);
      throw new HTTPException(500, { message: 'No se pudo completar el alta.' });
    }
    membershipId = membership.id;
  }

  if (Array.isArray(b.site_ids)) {
    const rows = b.site_ids.filter((s): s is string => typeof s === 'string' && UUID_RE.test(s)).map((site_id) => ({ membership_id: membershipId, site_id }));
    if (rows.length) {
      const { error } = await core.from('membership_sites').insert(rows);
      if (error) console.error('membership_sites insert failed', error);
    }
  }

  await audit(c.env, {
    company_id: companyId,
    actor_id: auth.userId,
    action: `member.created.${roleKey}`,
    entity: isWorker ? 'core.employees' : 'core.memberships',
    entity_id: employee?.id ?? membershipId,
  });

  return c.json(
    { employee, role: roleKey, login: isWorker ? { company_code: company.code, employee_number: employeeNumber } : { email: str(b.email).toLowerCase() } },
    201,
  );
});
