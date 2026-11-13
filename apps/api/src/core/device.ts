import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { forgetVerifiedSession, requireSession, sessionVerified } from '../lib/auth';
import { CodedError } from '../lib/errors';
import { str } from '../lib/input';
import { codeEmail, sendMail } from '../lib/mail';
import { adminClient, audit, coreDb } from '../lib/supabase';

/**
 * Segundo paso por correo para administradores (Dirección, 13 nov 2026).
 *
 *   POST /api/core/device/check  { device_token? }       ¿la sesión ya está verificada? (un dispositivo de confianza la verifica sola)
 *   POST /api/core/device/send   { purpose }               manda un código de 6 dígitos al correo
 *   POST /api/core/device/verify { code, purpose, label? } valida el código; en un dispositivo nuevo devuelve su token (30 días)
 *   POST /api/core/account/password { password }          cambia la contraseña (pide un código reciente) o crea la primera
 *
 * Se pide código: en un dispositivo o navegador nuevo, cada 30 días y antes de cambios sensibles
 * (contraseña, correo, RFC o razón social, administradores y permisos).
 */
const TRUST_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_15_MIN = 5;
/** Un cambio sensible acepta un código escrito en los últimos 10 minutos. */
const STEP_UP_MINUTES = 10;
/** La primera contraseña (registro o recuperación) se crea dentro de 15 minutos del código del correo. */
const FIRST_PASSWORD_MINUTES = 15;

const enc = new TextEncoder();
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sixDigits(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, '0');
}
const addDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/** Nombre corto del navegador para el correo y la lista de dispositivos. */
function deviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'un navegador';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} en ${os}` : browser;
}

/** ¿La sesión se inició con contraseña (u otro proveedor que la reemplace), y no solo con un código? */
const passwordSession = (amr: { method: string }[]) => amr.some((a) => ['password', 'oauth', 'sso/saml'].includes(a.method));
/** ¿La sesión viene de un código del correo de hace poco (registro o recuperación de contraseña)? */
const recentEmailProof = (amr: { method: string; timestamp: number }[]) =>
  amr.some((a) => ['otp', 'recovery', 'magiclink', 'email/signup'].includes(a.method) && Date.now() / 1000 - a.timestamp < FIRST_PASSWORD_MINUTES * 60);

async function trustSession(c: Context<AppEnv>, label: string) {
  const auth = c.get('auth');
  const core = coreDb(adminClient(c.env));
  const token = randomToken();
  const expires = addDays(TRUST_DAYS);
  const { data: device, error } = await core
    .from('trusted_devices')
    .insert({ user_id: auth.userId, token_hash: await sha256(token), label, expires_at: expires })
    .select('id')
    .single();
  if (error || !device) throw new HTTPException(500, { message: 'No se pudo guardar el dispositivo.' });
  await core
    .from('verified_sessions')
    .upsert({ session_id: auth.sessionId, user_id: auth.userId, device_id: device.id, verified_at: new Date().toISOString(), step_up_at: new Date().toISOString(), expires_at: expires });
  forgetVerifiedSession(auth.sessionId);
  return token;
}

export const device = new Hono<AppEnv>();
device.use('*', requireSession);

device.post('/check', async (c) => {
  const auth = c.get('auth');
  if (auth.isWorker) return c.json({ verified: true });
  if (!auth.sessionId) throw new HTTPException(401, { message: 'Tu sesión expiró. Vuelve a iniciar sesión.' });
  const core = coreDb(adminClient(c.env));
  if (await sessionVerified(c.env, auth.userId, auth.sessionId)) return c.json({ verified: true });

  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const token = str(b.device_token, 100);
  // Dispositivo de confianza: con contraseña basta, sin código, hasta que se cumplan los 30 días
  if (token && passwordSession(auth.amr)) {
    const { data: dev } = await core
      .from('trusted_devices')
      .select('id, expires_at')
      .eq('user_id', auth.userId)
      .eq('token_hash', await sha256(token))
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (dev) {
      await Promise.all([
        core.from('verified_sessions').upsert({ session_id: auth.sessionId, user_id: auth.userId, device_id: dev.id, expires_at: dev.expires_at }),
        core.from('trusted_devices').update({ last_used_at: new Date().toISOString() }).eq('id', dev.id),
      ]);
      forgetVerifiedSession(auth.sessionId);
      return c.json({ verified: true });
    }
  }
  return c.json({
    verified: false,
    // Sin contraseña todavía (cuenta creada con código o contraseña olvidada): primero la crea
    needsPassword: !passwordSession(auth.amr),
    canSetPassword: !passwordSession(auth.amr) && recentEmailProof(auth.amr),
    email: auth.email,
  });
});

device.post('/send', async (c) => {
  const auth = c.get('auth');
  if (auth.isWorker || !auth.email || !auth.sessionId) throw new HTTPException(400, { message: 'Esta cuenta no usa código por correo.' });
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const purpose = b.purpose === 'sensitive' ? 'sensitive' : 'device';
  if (purpose === 'device' && !passwordSession(auth.amr)) {
    throw new HTTPException(400, { message: 'Primero entra con tu contraseña.' });
  }
  if (purpose === 'sensitive' && !(await sessionVerified(c.env, auth.userId, auth.sessionId))) {
    throw new HTTPException(403, { message: 'Primero confirma este dispositivo.' });
  }
  const core = coreDb(adminClient(c.env));
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await core.from('email_challenges').select('id', { count: 'exact', head: true }).eq('user_id', auth.userId).gte('created_at', since);
  if ((count ?? 0) >= MAX_CODES_PER_15_MIN) {
    throw new HTTPException(429, { message: 'Ya te enviamos varios códigos. Espera unos minutos antes de pedir otro.' });
  }
  const code = sixDigits();
  const id = crypto.randomUUID();
  const { error } = await core.from('email_challenges').insert({
    id,
    user_id: auth.userId,
    session_id: auth.sessionId,
    purpose,
    code_hash: await sha256(`${id}:${code}`),
    expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
  });
  if (error) throw new HTTPException(500, { message: 'No se pudo generar el código.' });
  const mail = codeEmail(code, purpose, deviceLabel(c.req.header('User-Agent') ?? ''));
  await sendMail(c.env, auth.email, mail.subject, mail.html, mail.text);
  return c.json({ ok: true, email: auth.email });
});

device.post('/verify', async (c) => {
  const auth = c.get('auth');
  if (auth.isWorker || !auth.sessionId) throw new HTTPException(400, { message: 'Esta cuenta no usa código por correo.' });
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const purpose = b.purpose === 'sensitive' ? 'sensitive' : 'device';
  const code = str(b.code, 10).replace(/\D/g, '');
  if (code.length !== 6) throw new HTTPException(400, { message: 'Escribe los 6 números del código.' });
  const core = coreDb(adminClient(c.env));
  const { data: ch } = await core
    .from('email_challenges')
    .select('id, code_hash, attempts, expires_at')
    .eq('user_id', auth.userId)
    .eq('session_id', auth.sessionId)
    .eq('purpose', purpose)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ch || new Date(ch.expires_at).getTime() < Date.now()) {
    throw new HTTPException(400, { message: 'El código venció. Pide uno nuevo.' });
  }
  if (ch.attempts >= MAX_ATTEMPTS) throw new HTTPException(429, { message: 'Demasiados intentos. Pide un código nuevo.' });
  if ((await sha256(`${ch.id}:${code}`)) !== ch.code_hash) {
    await core.from('email_challenges').update({ attempts: ch.attempts + 1 }).eq('id', ch.id);
    throw new HTTPException(400, { message: 'El código no es correcto. Revísalo e intenta de nuevo.' });
  }
  await core.from('email_challenges').update({ used_at: new Date().toISOString() }).eq('id', ch.id);

  if (purpose === 'sensitive') {
    await core.from('verified_sessions').update({ step_up_at: new Date().toISOString() }).eq('session_id', auth.sessionId).eq('user_id', auth.userId);
    return c.json({ ok: true });
  }
  if (!passwordSession(auth.amr)) throw new HTTPException(400, { message: 'Primero entra con tu contraseña.' });
  const label = deviceLabel(c.req.header('User-Agent') ?? '');
  const token = await trustSession(c, label);
  await audit(c.env, { company_id: null, actor_id: auth.userId, action: 'core.device.trusted', entity: 'core.trusted_devices', details: { label } });
  return c.json({ ok: true, device_token: token, days: TRUST_DAYS });
});

/** ¿El usuario escribió un código en los últimos 10 minutos? Si no, la app pide uno (cambios sensibles). */
export async function requireRecentCode(c: Context<AppEnv>): Promise<void> {
  const auth = c.get('auth');
  if (auth.isWorker || auth.isPlatformAdmin) return;
  const { data } = await coreDb(adminClient(c.env)).from('verified_sessions').select('step_up_at').eq('session_id', auth.sessionId).eq('user_id', auth.userId).maybeSingle();
  if (!data?.step_up_at || Date.now() - new Date(data.step_up_at).getTime() > STEP_UP_MINUTES * 60_000) {
    throw new CodedError(403, 'Para este cambio, confirma con el código que te enviaremos a tu correo.', 'step_up');
  }
}

// ---------------------------------------------------------------------
// Contraseña
// ---------------------------------------------------------------------
export const account = new Hono<AppEnv>();
account.use('*', requireSession);

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Usa al menos 10 caracteres.';
  if (password.length > 72) return 'Usa como máximo 72 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(password) || !/\d/.test(password)) return 'Combina letras y números.';
  return null;
}

account.post('/password', async (c) => {
  const auth = c.get('auth');
  if (auth.isWorker) throw new HTTPException(400, { message: 'Los trabajadores entran con su PIN.' });
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const password = typeof b.password === 'string' ? b.password : '';
  const problem = passwordProblem(password);
  if (problem) throw new HTTPException(400, { message: problem });

  const verified = await sessionVerified(c.env, auth.userId, auth.sessionId);
  // Primera contraseña: en el registro o al recuperarla, con el código del correo de hace menos de 15 minutos
  const firstPassword = !verified && !passwordSession(auth.amr) && recentEmailProof(auth.amr);
  if (!verified && !firstPassword) throw new CodedError(403, 'Confirma que eres tú con el código de tu correo.', 'device_verify');
  if (verified) await requireRecentCode(c);

  const { error } = await adminClient(c.env).auth.admin.updateUserById(auth.userId, { password });
  if (error) {
    console.error('password update failed', error);
    throw new HTTPException(400, { message: /weak|pwned|leak/i.test(error.message) ? 'Esa contraseña es demasiado común. Elige otra.' : 'No se pudo guardar la contraseña.' });
  }
  const core = coreDb(adminClient(c.env));
  // Al cambiar la contraseña se cierran los demás dispositivos de confianza
  await Promise.all([
    core.from('trusted_devices').delete().eq('user_id', auth.userId),
    core.from('verified_sessions').delete().eq('user_id', auth.userId).neq('session_id', auth.sessionId ?? ''),
  ]);
  // Quien acaba de probar su correo y crear su contraseña ya pasó los dos pasos en este dispositivo
  const token = await trustSession(c, deviceLabel(c.req.header('User-Agent') ?? ''));
  await audit(c.env, { company_id: null, actor_id: auth.userId, action: firstPassword ? 'core.password.created' : 'core.password.changed', entity: 'auth.users', details: {} });
  return c.json({ ok: true, device_token: token });
});
