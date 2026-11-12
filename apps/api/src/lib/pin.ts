import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env';
import { adminClient, coreDb } from './supabase';

/**
 * PIN del trabajador (4 dígitos) y código de activación (6 dígitos).
 *
 * Con tan pocos dígitos, la protección real es el bloqueo tras intentos fallidos
 * (5 intentos → 15 minutos) y que solo la API lee los hashes. Se guardan con
 * sal y PBKDF2 para que no queden en claro.
 */
const ITERATIONS = 2000;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
export const ACTIVATION_DAYS = 7;

const enc = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return b64(bits);
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${await derive(secret, salt, ITERATIONS)}`;
}

export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const got = await derive(secret, unb64(salt), Number(iter));
  // Comparación en tiempo constante
  if (got.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export const PIN_RE = /^\d{4}$/;
export const ACTIVATION_RE = /^\d{6}$/;

/** PIN fácil de adivinar (1111, 1234, 4321…). */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const d = pin.split('').map(Number);
  const up = d.every((v, i) => i === 0 || v === (d[i - 1]! + 1) % 10);
  const down = d.every((v, i) => i === 0 || v === (d[i - 1]! + 9) % 10);
  return up || down;
}

export function newActivationCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, '0');
}

export interface Credentials {
  employee_id: string;
  company_id: string;
  pin_hash: string | null;
  pin_set_at: string | null;
  activation_hash: string | null;
  activation_expires_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
}

export async function loadCredentials(env: Env, employeeId: string): Promise<Credentials | null> {
  const { data } = await coreDb(adminClient(env)).from('employee_credentials').select('*').eq('employee_id', employeeId).maybeSingle();
  return (data as Credentials | null) ?? null;
}

function lockedMessage(until: string): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 60_000));
  return `Demasiados intentos. Espera ${minutes} min o pide ayuda a tu supervisor.`;
}

/**
 * Comprueba un secreto (PIN o código de activación) con bloqueo por intentos.
 * Lanza 423 si está bloqueado y 401 si no coincide.
 */
export async function checkWithLockout(
  env: Env,
  creds: Credentials,
  ok: () => Promise<boolean>,
  wrongMessage: string,
): Promise<void> {
  const core = coreDb(adminClient(env));
  if (creds.locked_until && Date.parse(creds.locked_until) > Date.now()) {
    throw new HTTPException(423, { message: lockedMessage(creds.locked_until) });
  }
  if (await ok()) {
    if (creds.failed_attempts || creds.locked_until) {
      await core.from('employee_credentials').update({ failed_attempts: 0, locked_until: null }).eq('employee_id', creds.employee_id);
    }
    return;
  }
  const attempts = (creds.locked_until ? 0 : creds.failed_attempts) + 1;
  const lock = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
  await core
    .from('employee_credentials')
    .update({ failed_attempts: lock ? 0 : attempts, locked_until: lock })
    .eq('employee_id', creds.employee_id);
  if (lock) throw new HTTPException(423, { message: lockedMessage(lock) });
  const left = MAX_ATTEMPTS - attempts;
  throw new HTTPException(401, { message: `${wrongMessage} Te quedan ${left} intento${left === 1 ? '' : 's'}.` });
}

/** Verifica el PIN del colaborador (para firmar o checar sin biometría). */
export async function requirePin(env: Env, employeeId: string, pin: unknown): Promise<void> {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw new HTTPException(400, { message: 'Escribe tu PIN de 4 dígitos.' });
  const creds = await loadCredentials(env, employeeId);
  if (!creds?.pin_hash) throw new HTTPException(409, { message: 'Todavía no tienes PIN. Pide a tu supervisor un código de activación.' });
  await checkWithLockout(env, creds, () => verifySecret(pin, creds.pin_hash), 'El PIN no es correcto.');
}
