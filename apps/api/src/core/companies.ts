import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { MODULES } from '@korporia/core';
import type { AppEnv } from '../env';
import { requireAuth } from '../lib/auth';
import { adminClient, coreDb } from '../lib/supabase';
import { EMAIL_RE, str } from '../lib/input';

export const companies = new Hono<AppEnv>();
companies.use('*', requireAuth);

const CODE_RE = /^[a-z0-9]{3,16}$/;
const BILLABLE = MODULES.filter((m) => m.billable).map((m) => m.key as string);

/**
 * Plataforma (Erik): crea una empresa cliente con su usuario propietario.
 * POST /api/core/companies { name, code, owner_email, owner_password, owner_name, employee_limit?, trial_days?, modules? }
 */
companies.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.isPlatformAdmin) throw new HTTPException(403, { message: 'Solo el administrador de la plataforma puede crear empresas.' });
  const b = await c.req.json<Record<string, unknown>>();
  const name = str(b.name);
  const code = str(b.code, 16).toLowerCase();
  const ownerEmail = str(b.owner_email).toLowerCase();
  const ownerPassword = typeof b.owner_password === 'string' ? b.owner_password : '';
  const employeeLimit = Number(b.employee_limit ?? 3);
  const trialDays = Number(b.trial_days ?? 15);
  const modules = Array.isArray(b.modules) ? b.modules.filter((m): m is string => typeof m === 'string') : ['jornada'];

  if (!name || !CODE_RE.test(code)) throw new HTTPException(400, { message: 'Nombre o código inválido (código: 3–16 letras minúsculas o números).' });
  if (!EMAIL_RE.test(ownerEmail) || ownerPassword.length < 8) throw new HTTPException(400, { message: 'Correo o contraseña del propietario inválidos (mínimo 8 caracteres).' });
  if (!Number.isInteger(employeeLimit) || employeeLimit < 1 || employeeLimit > 10000) throw new HTTPException(400, { message: 'Límite de colaboradores inválido.' });
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) throw new HTTPException(400, { message: 'Días de prueba inválidos.' });
  if (modules.some((m) => !BILLABLE.includes(m))) throw new HTTPException(400, { message: 'Módulo desconocido.' });

  const admin = adminClient(c.env);
  const core = coreDb(admin);
  const { data: taken } = await core.from('companies').select('id').eq('code', code).maybeSingle();
  if (taken) throw new HTTPException(409, { message: 'Ese código de empresa ya existe.' });

  const created = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: { full_name: str(b.owner_name) },
  });
  if (created.error || !created.data.user) {
    throw new HTTPException(400, { message: `No se pudo crear el usuario propietario: ${created.error?.message ?? 'error desconocido'}` });
  }

  // Empresa, suscripción de prueba, módulos y dueño en una sola transacción
  const { data: companyId, error } = await core.rpc('provision_company', {
    p_name: name,
    p_code: code,
    p_owner: created.data.user.id,
    p_employee_limit: employeeLimit,
    p_trial_days: trialDays,
    p_modules: modules,
  });
  if (error || !companyId) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    if (error?.code === '23505') throw new HTTPException(409, { message: 'Ese código de empresa ya existe.' });
    console.error('provision_company failed', error);
    throw new HTTPException(500, { message: 'No se pudo crear la empresa.' });
  }

  return c.json({ company: { id: companyId, name, code, modules } }, 201);
});
