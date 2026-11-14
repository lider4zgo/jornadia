import { HTTPException } from 'hono/http-exception';
import { workerEmail } from '@korporia/core';
import type { Env } from '../env';
import { randomSecret, str, UUID_RE } from '../lib/input';
import { adminClient, coreDb } from '../lib/supabase';
import { MODULE_REGISTRY } from '../modules';

export interface NewWorker {
  employee_number: string;
  full_name: string;
  phone?: string | null;
  position?: string | null;
  default_site_id?: string | null;
}

/**
 * Crea la cuenta de un colaborador: usuario (sin contraseña conocida; entra con código de empresa +
 * número + PIN), membresía con el rol de trabajador, expediente en core.employees y los datos de
 * cada módulo contratado. Si algo falla, deshace lo creado.
 * La revisión de permisos y del límite de colaboradores la hace quien llama.
 */
export async function createWorkerAccount(
  env: Env,
  input: {
    actorId: string;
    companyId: string;
    companyCode: string;
    roleId: string;
    activeModules: Set<string>;
    worker: NewWorker;
    /** Cuerpo original del alta (algunos módulos leen campos propios, p. ej. el consentimiento) */
    body?: Record<string, unknown>;
  },
): Promise<{ employee: { id: string; employee_number: string; full_name: string }; userId: string; membershipId: string }> {
  const admin = adminClient(env);
  const core = coreDb(admin);
  const { companyId, worker } = input;

  const created = await admin.auth.admin.createUser({
    email: workerEmail(worker.employee_number, input.companyCode, env.WORKER_EMAIL_DOMAIN),
    password: randomSecret(),
    email_confirm: true,
    user_metadata: { full_name: worker.full_name, company_id: companyId, employee_number: worker.employee_number },
  });
  if (created.error || !created.data.user) {
    const msg = created.error?.message?.includes('already') ? 'Ya existe una cuenta con ese número o correo.' : 'No se pudo crear la cuenta.';
    throw new HTTPException(409, { message: msg });
  }
  const userId = created.data.user.id;
  let employeeId: string | null = null;
  const rollback = async () => {
    if (employeeId) await core.from('employees').delete().eq('id', employeeId);
    await admin.auth.admin.deleteUser(userId);
  };

  const { data: membership, error: mErr } = await core
    .from('memberships')
    .insert({ company_id: companyId, user_id: userId, role_id: input.roleId })
    .select('id')
    .single();
  if (mErr || !membership) {
    await rollback();
    throw new HTTPException(500, { message: 'No se pudo completar el alta.' });
  }

  const site = str(worker.default_site_id ?? '', 36);
  const res = await core
    .from('employees')
    .insert({
      company_id: companyId,
      user_id: userId,
      employee_number: worker.employee_number,
      full_name: worker.full_name,
      phone: str(worker.phone ?? '', 20) || null,
      position: str(worker.position ?? '', 80) || null,
      default_site_id: UUID_RE.test(site) ? site : null,
    })
    .select('id, employee_number, full_name')
    .single();
  if (res.error || !res.data) {
    await rollback();
    const dup = res.error?.code === '23505';
    throw new HTTPException(dup ? 409 : 500, { message: dup ? 'Ese número de empleado ya existe.' : 'No se pudo completar el alta.' });
  }
  employeeId = res.data.id;

  // Cada módulo contratado prepara sus propios datos del colaborador
  try {
    for (const m of MODULE_REGISTRY) {
      if (m.onEmployeeCreated && input.activeModules.has(m.key)) {
        await m.onEmployeeCreated(env, { actorId: input.actorId, employeeId: res.data.id, companyId, body: input.body ?? {} });
      }
    }
  } catch (err) {
    console.error('onEmployeeCreated failed', err);
    await rollback();
    throw new HTTPException(500, { message: 'No se pudo completar el alta.' });
  }
  return { employee: res.data, userId, membershipId: membership.id };
}
