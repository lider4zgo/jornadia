import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { WorkerDocKey } from '@korporia/core';
import type { AppEnv, Env } from '../env';
import { requireAuth, resolveCompany } from '../lib/auth';
import { requirePin } from '../lib/pin';
import { adminClient, audit, coreDb } from '../lib/supabase';
import { applyBiometricChoice, workerDocsState, type BiometricChoice } from '../lib/worker-docs';

/**
 * Lo del propio trabajador: documentos que firma y su privacidad (GET/POST /api/core/my/…).
 * Firma con su PIN; cada firma queda en core.employee_acceptances, sin poder editarse.
 */
export const my = new Hono<AppEnv>();
my.use('*', requireAuth);

async function selfEmployee(env: Env, companyId: string, userId: string) {
  const { data } = await coreDb(adminClient(env))
    .from('employees')
    .select('id, company_id, full_name, employee_number, active')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new HTTPException(403, { message: 'Tu usuario no está registrado como colaborador.' });
  if (!data.active) throw new HTTPException(403, { message: 'Tu usuario está dado de baja.' });
  return data;
}

/** Documentos vigentes con los datos de la empresa y cuáles faltan por firmar. */
my.get('/documents', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  const employee = await selfEmployee(c.env, companyId, auth.userId);
  return c.json(await workerDocsState(c.env, employee));
});

/**
 * Firma los documentos pendientes.
 * POST /api/core/my/documents/sign { accept: ['aviso_trabajadores','acuerdo_jornada'], biometric?: 'autorizo'|'no_autorizo', pin }
 */
my.post('/documents/sign', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  const employee = await selfEmployee(c.env, companyId, auth.userId);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const accept = new Set(Array.isArray(b.accept) ? b.accept.filter((x): x is string => typeof x === 'string') : []);
  const biometric = b.biometric === 'autorizo' || b.biometric === 'no_autorizo' ? (b.biometric as BiometricChoice) : null;

  const state = await workerDocsState(c.env, employee);
  const rows: { document: WorkerDocKey; version: string; choice: string }[] = [];
  for (const doc of state.pending) {
    if (doc === 'biometria') {
      if (!biometric) throw new HTTPException(400, { message: 'Elige si autorizas o no el uso de tu rostro.' });
      rows.push({ document: doc, version: state.docs.biometria!.version, choice: biometric });
    } else {
      if (!accept.has(doc)) {
        throw new HTTPException(400, {
          message: doc === 'aviso_trabajadores' ? 'Confirma que leíste el aviso de privacidad.' : 'Para usar el registro de jornada debes aceptar el acuerdo.',
        });
      }
      const version = doc === 'aviso_trabajadores' ? state.docs.aviso.version : state.docs.acuerdo!.version;
      rows.push({ document: doc, version, choice: 'acepto' });
    }
  }
  if (rows.length === 0) return c.json(state);

  await requirePin(c.env, employee.id, b.pin);

  const ip = c.req.header('CF-Connecting-IP') ?? null;
  const ua = (c.req.header('User-Agent') ?? '').slice(0, 300) || null;
  const { error } = await coreDb(adminClient(c.env))
    .from('employee_acceptances')
    .insert(rows.map((r) => ({ ...r, company_id: companyId, employee_id: employee.id, method: 'pin', recorded_by: auth.userId, ip, user_agent: ua })));
  if (error) {
    console.error('acceptances insert failed', error);
    throw new HTTPException(500, { message: 'No se pudo guardar tu firma. Intenta de nuevo.' });
  }
  const bio = rows.find((r) => r.document === 'biometria');
  if (bio) await applyBiometricChoice(c.env, employee, bio.choice as BiometricChoice, auth.userId);
  await audit(c.env, {
    company_id: companyId,
    actor_id: auth.userId,
    action: 'worker.documents_signed',
    entity: 'core.employees',
    entity_id: employee.id,
    details: Object.fromEntries(rows.map((r) => [r.document, `${r.choice} (${r.version})`])),
  });
  return c.json(await workerDocsState(c.env, employee));
});

/**
 * "Mi privacidad": autorizar o retirar el uso del rostro en cualquier momento.
 * POST /api/core/my/biometric { choice: 'autorizo'|'retiro', pin }
 * Al retirarlo se borra la foto de registro y el trabajador pasa a checar con PIN.
 */
my.post('/biometric', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  const employee = await selfEmployee(c.env, companyId, auth.userId);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (b.choice !== 'autorizo' && b.choice !== 'retiro') throw new HTTPException(400, { message: 'Opción inválida.' });
  const choice = b.choice as BiometricChoice;
  await requirePin(c.env, employee.id, b.pin);

  const state = await workerDocsState(c.env, employee);
  if (!state.docs.biometria) throw new HTTPException(400, { message: 'Tu empresa no usa el registro de jornada.' });
  const { error } = await coreDb(adminClient(c.env)).from('employee_acceptances').insert({
    company_id: companyId,
    employee_id: employee.id,
    document: 'biometria',
    version: state.docs.biometria.version,
    choice,
    method: 'pin',
    recorded_by: auth.userId,
    ip: c.req.header('CF-Connecting-IP') ?? null,
    user_agent: (c.req.header('User-Agent') ?? '').slice(0, 300) || null,
  });
  if (error) throw new HTTPException(500, { message: 'No se pudo guardar tu decisión.' });
  await applyBiometricChoice(c.env, employee, choice, auth.userId);
  await audit(c.env, {
    company_id: companyId,
    actor_id: auth.userId,
    action: choice === 'retiro' ? 'worker.biometric_withdrawn' : 'worker.biometric_authorized',
    entity: 'core.employees',
    entity_id: employee.id,
  });
  return c.json(await workerDocsState(c.env, employee));
});
