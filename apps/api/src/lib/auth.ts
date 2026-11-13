import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createRemoteJWKSet, decodeJwt, errors, jwtVerify, type JWTPayload } from 'jose';
import { MODULES, moduleOf, READ_ONLY_OK } from '@korporia/core';
import type { AppEnv, AuthContext, CompanyAccess, CompanyStatus, Env } from '../env';
import { CodedError } from './errors';
import { adminClient, coreDb } from './supabase';

// ---------------------------------------------------------------------
// Validación del token
// ---------------------------------------------------------------------
// Con llaves de firma asimétricas de Supabase (JWT Signing Keys) el token se
// valida aquí mismo, sin llamar a Supabase. Si el proyecto usa la llave
// compartida antigua (HS256), se valida con Supabase Auth como antes.
let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

function projectJwks(env: Env) {
  const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  if (jwks?.url !== url) jwks = { url, set: createRemoteJWKSet(new URL(url)) };
  return jwks.set;
}

const SESSION_EXPIRED = 'Tu sesión expiró. Vuelve a iniciar sesión.';

async function verifiedPayload(env: Env, token: string): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, projectJwks(env), {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });
    if (typeof payload.sub === 'string' && payload.sub) return payload;
  } catch (err) {
    if (err instanceof errors.JWTExpired) throw new HTTPException(401, { message: SESSION_EXPIRED });
    // Llave antigua, llave rotada o JWKS no disponible: se valida con Supabase Auth
  }
  const { data, error } = await adminClient(env).auth.getUser(token);
  if (error || !data.user) throw new HTTPException(401, { message: SESSION_EXPIRED });
  // Supabase ya validó el token: se leen sus datos (session_id, amr) sin volver a verificar la firma
  return { ...decodeJwt(token), sub: data.user.id };
}

// ---------------------------------------------------------------------
// Segundo paso por correo (administradores)
// ---------------------------------------------------------------------
const VERIFIED_TTL_MS = 30_000;
const verifiedCache = new Map<string, { at: number; ok: boolean }>();

export function forgetVerifiedSession(sessionId: string | null) {
  if (sessionId) verifiedCache.delete(sessionId);
}

/** ¿La sesión ya pasó el segundo paso y sigue vigente? */
export async function sessionVerified(env: Env, userId: string, sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  const hit = verifiedCache.get(sessionId);
  if (hit && Date.now() - hit.at < VERIFIED_TTL_MS) return hit.ok;
  const { data } = await coreDb(adminClient(env))
    .from('verified_sessions')
    .select('session_id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  const ok = Boolean(data);
  if (verifiedCache.size >= MAX_CACHED_USERS) verifiedCache.delete(verifiedCache.keys().next().value!);
  verifiedCache.set(sessionId, { at: Date.now(), ok });
  return ok;
}

export const DEVICE_VERIFY = 'device_verify';

// ---------------------------------------------------------------------
// Accesos del usuario (con caché breve por instancia del Worker)
// ---------------------------------------------------------------------
// Un cambio de rol o de plan tarda como máximo ACCESS_TTL_MS en reflejarse
// en otras instancias; en esta instancia se invalida de inmediato.
const ACCESS_TTL_MS = 30_000;
const MAX_CACHED_USERS = 1000;
const accessCache = new Map<string, { at: number; access: CompanyAccess[]; isPlatformAdmin: boolean }>();

export function invalidateAccess(userId?: string) {
  if (userId) accessCache.delete(userId);
  else accessCache.clear();
}

async function loadAccess(env: Env, userId: string) {
  const hit = accessCache.get(userId);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit;

  const core = coreDb(adminClient(env));
  const [{ data: rows, error }, { data: platform }] = await Promise.all([
    core.rpc('user_access', { p_user: userId }),
    core.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (error) {
    console.error('user_access failed', error);
    throw new HTTPException(500, { message: 'No se pudieron cargar tus permisos. Intenta de nuevo.' });
  }
  type Row = {
    membership_id: string;
    company_id: string;
    role_key: string;
    permissions: string[];
    modules: string[];
    writable: string[] | null;
    status: CompanyStatus | null;
  };
  const value = {
    at: Date.now(),
    isPlatformAdmin: Boolean(platform),
    access: ((rows ?? []) as Row[]).map((r) => ({
      membershipId: r.membership_id,
      companyId: r.company_id,
      role: r.role_key,
      permissions: new Set(r.permissions),
      modules: new Set(r.modules),
      writable: new Set(r.writable ?? r.modules),
      status: r.status,
    })),
  };
  if (accessCache.size >= MAX_CACHED_USERS) accessCache.delete(accessCache.keys().next().value!);
  accessCache.set(userId, value);
  return value;
}

/** Valida el token y lee la sesión, sin exigir el segundo paso (rutas del propio segundo paso). */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HTTPException(401, { message: 'Inicia sesión para continuar.' });

  const payload = await verifiedPayload(c.env, token);
  const userId = payload.sub!;
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  const isWorker = Boolean(email && email.endsWith(`.${c.env.WORKER_EMAIL_DOMAIN}`));
  const amr = Array.isArray(payload.amr) ? (payload.amr as { method: string; timestamp: number }[]) : [];
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
  const auth: AuthContext = { userId, accessToken: token, access: [], isPlatformAdmin: false, sessionId, isWorker, amr, email };
  c.set('auth', auth);
  await next();
};

/** Valida el token, exige el segundo paso a los administradores y carga sus accesos. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireSession(c, async () => {
    const auth = c.get('auth');
    if (!auth.isWorker && !(await sessionVerified(c.env, auth.userId, auth.sessionId))) {
      throw new CodedError(403, 'Confirma que eres tú con el código que te enviamos a tu correo.', DEVICE_VERIFY);
    }
    const { access, isPlatformAdmin } = await loadAccess(c.env, auth.userId);
    auth.access = access;
    auth.isPlatformAdmin = isPlatformAdmin;
  });
  await next();
};

// ---------------------------------------------------------------------
// Empresa activa y permisos
// ---------------------------------------------------------------------
/** Empresa activa: la indicada en el encabezado X-Company-Id o la única que tenga el usuario. */
export function resolveCompany(auth: AuthContext, requested?: string | null): string {
  if (requested) {
    if (auth.access.some((a) => a.companyId === requested) || auth.isPlatformAdmin) return requested;
    throw new HTTPException(403, { message: 'No perteneces a esta empresa.' });
  }
  const unique = [...new Set(auth.access.map((a) => a.companyId))];
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 0) throw new HTTPException(403, { message: 'Tu usuario no está asignado a ninguna empresa.' });
  throw new HTTPException(400, { message: 'Selecciona una empresa.' });
}

export function accessFor(auth: AuthContext, companyId: string): CompanyAccess | null {
  return auth.access.find((a) => a.companyId === companyId) ?? null;
}

const SUSPENDED: CompanyStatus[] = ['suspended', 'archived'];
/** Siempre disponible, para contratar o reactivar la cuenta. */
const SUBSCRIPTION = 'core.empresa.suscripcion';

/** ¿El módulo está contratado y la cuenta activa? (el núcleo, salvo en una cuenta archivada) */
function moduleAvailable(a: CompanyAccess, module: string): boolean {
  if (module === 'core') return a.status !== 'archived';
  return a.modules.has(module) && !SUSPENDED.includes(a.status ?? 'trial');
}

/** Lo que el plan permite hoy: los cambios se bloquean cuando el módulo o la cuenta pasan a solo lectura. */
function allowedByPlan(a: CompanyAccess, permission: string): boolean {
  if (permission === SUBSCRIPTION) return true;
  const module = moduleOf(permission);
  return moduleAvailable(a, module) && (READ_ONLY_OK.has(permission) || a.writable.has(module));
}

/** Misma regla que core.can() en la base de datos. */
export function can(auth: AuthContext, companyId: string, permission: string): boolean {
  if (auth.isPlatformAdmin) return true;
  const a = accessFor(auth, companyId);
  return Boolean(a && a.permissions.has(permission) && allowedByPlan(a, permission));
}

/** Mensaje cuando el plan bloquea un permiso que el rol sí tiene. */
function planMessage(a: CompanyAccess, permission: string): string {
  const module = moduleOf(permission);
  const name = MODULES.find((m) => m.key === module)?.name ?? module;
  if (a.status === 'archived') return 'La cuenta de tu empresa está archivada. Contrata un plan para recuperarla.';
  if (SUSPENDED.includes(a.status ?? 'trial')) return 'La cuenta de tu empresa está suspendida. Avisa a tu administrador.';
  if (!a.modules.has(module) && module !== 'core') return `Tu empresa no tiene contratado el módulo ${name}.`;
  if (!a.writable.has('core')) return 'Tu plan terminó y la cuenta está en solo lectura: puedes consultar y exportar tu información. Contrata un plan para seguir usándola.';
  if (module === 'jornada') return 'El checador de Korporia Starter terminó. Tus registros siguen disponibles para consultar y exportar; contrata Jornada para seguir registrando.';
  return `El periodo de ${name} de tu plan terminó: puedes consultar tu información, pero no hacer cambios. Contrata un plan para seguir usándolo.`;
}

/** Exige al menos uno de los permisos. Distingue "lo bloquea el plan" (402) de "sin permiso" (403). */
export function requirePermission(auth: AuthContext, companyId: string, ...permissions: string[]): void {
  if (permissions.some((p) => can(auth, companyId, p))) return;
  const a = accessFor(auth, companyId);
  const blocked = a && permissions.find((p) => a.permissions.has(p) && !allowedByPlan(a, p));
  if (a && blocked) throw new HTTPException(402, { message: planMessage(a, blocked) });
  throw new HTTPException(403, { message: 'No tienes permiso para esta acción.' });
}

/** Permisos efectivos del usuario en la empresa (para la app y para otorgar roles). */
export function effectivePermissions(auth: AuthContext, companyId: string, all: string[]): string[] {
  return all.filter((p) => can(auth, companyId, p));
}
