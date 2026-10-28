import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { normalizeCompanyCode, normalizeEmployeeNumber } from '@jornadia/core';
import type { AppEnv } from '../env';
import { adminClient } from '../supabase';

/**
 * Entrada del trabajador sin NIP:
 *   1. lookup  → con código de empresa + número muestra empresa y nombre para confirmar.
 *   2. session → si confirma, se emite un token de un solo uso que la app canjea por una sesión.
 *
 * La identidad la protege la selfie de cada checada, comparada contra la foto de
 * registro que solo toma un supervisor o administrador en persona. Por eso no se
 * emite sesión a quien aún no tiene foto de registro.
 */
export const workerAuth = new Hono<AppEnv>();

const NOT_FOUND = 'No encontramos ese número de empleado en esa empresa. Revisa los datos o pregunta a tu supervisor.';

async function findEmployee(env: AppEnv['Bindings'], rawCode: unknown, rawNumber: unknown) {
  const code = normalizeCompanyCode(String(rawCode ?? ''));
  const number = normalizeEmployeeNumber(String(rawNumber ?? ''));
  if (code.length < 3 || !number) throw new HTTPException(400, { message: 'Escribe el código de empresa y tu número de empleado.' });

  const admin = adminClient(env);
  const { data: company } = await admin.from('companies').select('id, name, status').eq('code', code).maybeSingle();
  if (!company) throw new HTTPException(404, { message: NOT_FOUND });
  if (company.status === 'suspended' || company.status === 'archived') {
    throw new HTTPException(402, { message: 'La cuenta de tu empresa está suspendida. Avisa a tu supervisor.' });
  }

  // El número se compara normalizado (sin espacios, guiones ni mayúsculas)
  const { data: employees } = await admin
    .from('employees')
    .select('id, user_id, employee_number, full_name, active, face_enrolled_at')
    .eq('company_id', company.id);
  const employee = (employees ?? []).find((e) => normalizeEmployeeNumber(e.employee_number) === number);
  if (!employee || !employee.user_id) throw new HTTPException(404, { message: NOT_FOUND });
  if (!employee.active) throw new HTTPException(403, { message: 'Tu usuario está dado de baja. Habla con tu supervisor.' });
  return { admin, company, employee };
}

/** Muestra solo nombre y primer apellido, suficiente para que la persona se reconozca. */
function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.slice(0, Math.min(2, parts.length)).join(' ');
}

workerAuth.post('/lookup', async (c) => {
  const body = await c.req.json<{ code?: string; number?: string }>().catch(() => ({}) as Record<string, string>);
  const { company, employee } = await findEmployee(c.env, body.code, body.number);
  return c.json({
    company: company.name,
    name: displayName(employee.full_name),
    ready: Boolean(employee.face_enrolled_at),
  });
});

workerAuth.post('/session', async (c) => {
  const body = await c.req.json<{ code?: string; number?: string }>().catch(() => ({}) as Record<string, string>);
  const { admin, company, employee } = await findEmployee(c.env, body.code, body.number);

  if (!employee.face_enrolled_at) {
    throw new HTTPException(409, {
      message: 'Todavía no tienes foto de registro. Pide a tu supervisor que te la tome desde su celular antes de tu primera checada.',
    });
  }

  const { data: user } = await admin.auth.admin.getUserById(employee.user_id!);
  const email = user?.user?.email;
  if (!email) throw new HTTPException(500, { message: 'Tu cuenta no está completa. Avisa a tu supervisor.' });

  // Token de un solo uso; no se envía ningún correo
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error('generateLink failed', error);
    throw new HTTPException(500, { message: 'No se pudo iniciar sesión. Intenta de nuevo.' });
  }

  await admin.from('audit_log').insert({
    company_id: company.id,
    actor_id: employee.user_id,
    action: 'worker.signed_in',
    entity: 'employees',
    entity_id: employee.id,
    details: { ua: c.req.header('User-Agent')?.slice(0, 200), country: c.req.header('CF-IPCountry') },
  });

  return c.json({ token_hash: tokenHash });
});
