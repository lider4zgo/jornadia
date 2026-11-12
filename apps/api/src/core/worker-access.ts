import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { normalizeCompanyCode, normalizeEmployeeNumber } from '@korporia/core';
import type { AppEnv, Env } from '../env';
import { invalidateAccess, requireAuth, requirePermission } from '../lib/auth';
import { UUID_RE } from '../lib/input';
import {
  ACTIVATION_DAYS,
  ACTIVATION_RE,
  checkWithLockout,
  hashSecret,
  loadCredentials,
  newActivationCode,
  PIN_RE,
  verifySecret,
  weakPin,
} from '../lib/pin';
import { adminClient, audit, coreDb } from '../lib/supabase';

/**
 * Entrada del trabajador (sin correo ni contraseña), POST /api/core/worker-access/…
 *
 *  1. El administrador genera un código de activación de 6 dígitos (vence en 7 días)
 *     y se lo comparte al trabajador junto con el código de empresa y su número.
 *  2. lookup   → con código de empresa + número muestra empresa y nombre para confirmar.
 *  3. activate → con el código de activación, el trabajador crea su PIN de 4 dígitos.
 *  4. session  → las siguientes veces entra con su PIN.
 *
 * El PIN también firma el aviso, el acuerdo de jornada y el consentimiento
 * biométrico, y sirve para checar sin biometría.
 */
export const workerAccess = new Hono<AppEnv>();

const NOT_FOUND = 'No encontramos ese número de empleado en esa empresa. Revisa los datos o pregunta a tu supervisor.';

async function findEmployee(env: Env, rawCode: unknown, rawNumber: unknown) {
  const code = normalizeCompanyCode(String(rawCode ?? ''));
  const number = normalizeEmployeeNumber(String(rawNumber ?? ''));
  if (code.length < 3 || !number) throw new HTTPException(400, { message: 'Escribe el código de empresa y tu número de empleado.' });

  const core = coreDb(adminClient(env));
  const { data: company } = await core.from('companies').select('id, name').eq('code', code).maybeSingle();
  if (!company) throw new HTTPException(404, { message: NOT_FOUND });
  const { data: subscription } = await core.from('subscriptions').select('status').eq('company_id', company.id).maybeSingle();
  if (!subscription || subscription.status === 'suspended' || subscription.status === 'archived') {
    throw new HTTPException(402, { message: 'La cuenta de tu empresa no está activa. Avisa a tu supervisor.' });
  }

  // El número se compara normalizado (sin espacios, guiones ni mayúsculas)
  const { data: employees } = await core.from('employees').select('id, company_id, user_id, employee_number, full_name, active').eq('company_id', company.id);
  const employee = (employees ?? []).find((e) => normalizeEmployeeNumber(e.employee_number) === number);
  if (!employee || !employee.user_id) throw new HTTPException(404, { message: NOT_FOUND });
  if (!employee.active) throw new HTTPException(403, { message: 'Tu usuario está dado de baja. Habla con tu supervisor.' });
  return { company, employee: employee as typeof employee & { user_id: string } };
}

/** Muestra solo nombre y primer apellido, suficiente para que la persona se reconozca. */
function displayName(fullName: string): string {
  return fullName.trim().split(/\s+/).slice(0, 2).join(' ');
}

/** Token de un solo uso que la app canjea por la sesión del trabajador (no se envía correo). */
async function issueSession(env: Env, companyId: string, employee: { id: string; user_id: string }, ua?: string, country?: string) {
  const admin = adminClient(env);
  const { data: user } = await admin.auth.admin.getUserById(employee.user_id);
  const email = user?.user?.email;
  if (!email) throw new HTTPException(500, { message: 'Tu cuenta no está completa. Avisa a tu supervisor.' });
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error('generateLink failed', error);
    throw new HTTPException(500, { message: 'No se pudo iniciar sesión. Intenta de nuevo.' });
  }
  await audit(env, {
    company_id: companyId,
    actor_id: employee.user_id,
    action: 'worker.signed_in',
    entity: 'core.employees',
    entity_id: employee.id,
    details: { ua: ua?.slice(0, 200), country },
  });
  return tokenHash;
}

workerAccess.post('/lookup', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const { company, employee } = await findEmployee(c.env, body.code, body.number);
  const creds = await loadCredentials(c.env, employee.id);
  const activationPending = Boolean(creds?.activation_hash && creds.activation_expires_at && Date.parse(creds.activation_expires_at) > Date.now());
  return c.json({ company: company.name, name: displayName(employee.full_name), hasPin: Boolean(creds?.pin_hash), activationPending });
});

workerAccess.post('/session', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const { company, employee } = await findEmployee(c.env, body.code, body.number);
  const pin = typeof body.pin === 'string' ? body.pin : '';
  if (!PIN_RE.test(pin)) throw new HTTPException(400, { message: 'Escribe tu PIN de 4 dígitos.' });
  const creds = await loadCredentials(c.env, employee.id);
  if (!creds?.pin_hash) {
    throw new HTTPException(409, { message: 'Todavía no activas tu acceso. Escribe el código de activación que te dio tu supervisor.' });
  }
  await checkWithLockout(c.env, creds, () => verifySecret(pin, creds.pin_hash), 'El PIN no es correcto.');
  const token_hash = await issueSession(c.env, company.id, employee, c.req.header('User-Agent'), c.req.header('CF-IPCountry'));
  return c.json({ token_hash });
});

workerAccess.post('/activate', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const { company, employee } = await findEmployee(c.env, body.code, body.number);
  const code = typeof body.activation_code === 'string' ? body.activation_code.replace(/\s/g, '') : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  if (!ACTIVATION_RE.test(code)) throw new HTTPException(400, { message: 'El código de activación tiene 6 dígitos.' });
  if (!PIN_RE.test(pin)) throw new HTTPException(400, { message: 'Tu PIN debe tener 4 dígitos.' });
  if (weakPin(pin)) throw new HTTPException(400, { message: 'Elige un PIN más difícil de adivinar (no 1111 ni 1234).' });

  const creds = await loadCredentials(c.env, employee.id);
  if (!creds?.activation_hash || !creds.activation_expires_at || Date.parse(creds.activation_expires_at) <= Date.now()) {
    throw new HTTPException(410, { message: 'Tu código de activación venció o ya se usó. Pide uno nuevo a tu supervisor.' });
  }
  await checkWithLockout(c.env, creds, () => verifySecret(code, creds.activation_hash), 'El código de activación no es correcto.');

  const { error } = await coreDb(adminClient(c.env))
    .from('employee_credentials')
    .update({ pin_hash: await hashSecret(pin), pin_set_at: new Date().toISOString(), activation_hash: null, activation_expires_at: null })
    .eq('employee_id', employee.id);
  if (error) throw new HTTPException(500, { message: 'No se pudo guardar tu PIN. Intenta de nuevo.' });
  await audit(c.env, { company_id: company.id, actor_id: employee.user_id, action: 'worker.pin_set', entity: 'core.employees', entity_id: employee.id });

  const token_hash = await issueSession(c.env, company.id, employee, c.req.header('User-Agent'), c.req.header('CF-IPCountry'));
  return c.json({ token_hash });
});

/**
 * Administración: genera un código de activación para que el trabajador cree (o cambie) su PIN.
 * POST /api/core/worker-access/:employeeId/activation → { code, expires_at, company_code, employee_number }
 */
export const activation = new Hono<AppEnv>();
activation.use('*', requireAuth);

activation.post('/:id/activation', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HTTPException(400, { message: 'Colaborador inválido.' });
  const core = coreDb(adminClient(c.env));
  const { data: employee } = await core.from('employees').select('id, company_id, user_id, employee_number, full_name, phone, active').eq('id', id).maybeSingle();
  if (!employee) throw new HTTPException(404, { message: 'Colaborador no encontrado.' });
  requirePermission(auth, employee.company_id, 'core.personal.gestionar');
  if (!employee.active) throw new HTTPException(400, { message: 'El colaborador está dado de baja.' });
  if (!employee.user_id) throw new HTTPException(400, { message: 'El colaborador no tiene cuenta de acceso.' });

  const code = newActivationCode();
  const expires = new Date(Date.now() + ACTIVATION_DAYS * 86_400_000).toISOString();
  const { error } = await core.from('employee_credentials').upsert(
    {
      employee_id: employee.id,
      company_id: employee.company_id,
      activation_hash: await hashSecret(code),
      activation_expires_at: expires,
      failed_attempts: 0,
      locked_until: null,
    },
    { onConflict: 'employee_id' },
  );
  if (error) {
    console.error('activation upsert failed', error);
    throw new HTTPException(500, { message: 'No se pudo generar el código.' });
  }
  const { data: company } = await core.from('companies').select('code, name').eq('id', employee.company_id).single();
  invalidateAccess(employee.user_id);
  await audit(c.env, { company_id: employee.company_id, actor_id: auth.userId, action: 'worker.activation_issued', entity: 'core.employees', entity_id: employee.id });
  return c.json({
    code,
    expires_at: expires,
    company_code: company?.code,
    company_name: company?.name,
    employee_number: employee.employee_number,
    full_name: employee.full_name,
    phone: employee.phone,
  });
});
