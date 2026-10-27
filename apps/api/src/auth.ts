import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, AuthContext, Membership, Role } from './env';
import { adminClient } from './supabase';

/** Valida el token de Supabase y carga las membresías del usuario. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HTTPException(401, { message: 'Inicia sesión para continuar.' });

  const admin = adminClient(c.env);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HTTPException(401, { message: 'Tu sesión expiró. Vuelve a iniciar sesión.' });

  const [{ data: memberships }, { data: platform }] = await Promise.all([
    admin.from('memberships').select('id, company_id, role').eq('user_id', data.user.id).eq('active', true),
    admin.from('platform_admins').select('user_id').eq('user_id', data.user.id).maybeSingle(),
  ]);

  const auth: AuthContext = {
    userId: data.user.id,
    accessToken: token,
    memberships: (memberships ?? []) as Membership[],
    isPlatformAdmin: Boolean(platform),
  };
  c.set('auth', auth);
  await next();
};

/** Devuelve la membresía del usuario en la empresa si tiene alguno de los roles. */
export function membershipFor(auth: AuthContext, companyId: string, roles: Role[]): Membership | null {
  return auth.memberships.find((m) => m.company_id === companyId && roles.includes(m.role)) ?? null;
}

/** Empresa activa: la indicada en el encabezado X-Company-Id o la única que tenga el usuario. */
export function resolveCompany(auth: AuthContext, requested?: string | null): string {
  if (requested) {
    if (auth.memberships.some((m) => m.company_id === requested) || auth.isPlatformAdmin) return requested;
    throw new HTTPException(403, { message: 'No perteneces a esta empresa.' });
  }
  const unique = [...new Set(auth.memberships.map((m) => m.company_id))];
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 0) throw new HTTPException(403, { message: 'Tu usuario no está asignado a ninguna empresa.' });
  throw new HTTPException(400, { message: 'Selecciona una empresa.' });
}

export function requireRole(auth: AuthContext, companyId: string, roles: Role[]): Membership {
  const m = membershipFor(auth, companyId, roles);
  if (!m && !auth.isPlatformAdmin) throw new HTTPException(403, { message: 'No tienes permiso para esta acción.' });
  return m ?? { id: 'platform', company_id: companyId, role: 'owner' };
}
