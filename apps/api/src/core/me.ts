import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { PERMISSIONS } from '@korporia/core';
import type { AppEnv } from '../env';
import { accessFor, effectivePermissions, requireAuth, resolveCompany } from '../lib/auth';
import { adminClient, coreDb } from '../lib/supabase';
import { MODULE_REGISTRY } from '../modules';
import type { SelfEmployee } from '../modules/types';

export const me = new Hono<AppEnv>();
me.use('*', requireAuth);

const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key);
const SUSPENDED = ['suspended', 'archived'];

/**
 * Todo lo que la app necesita al abrir: empresa, suscripción, rol, permisos,
 * módulos activos, obras, expediente del usuario y los datos de cada módulo.
 */
me.get('/', async (c) => {
  const auth = c.get('auth');
  const core = coreDb(adminClient(c.env));
  const serverTime = new Date().toISOString();

  if (auth.access.length === 0) {
    return c.json({ userId: auth.userId, isPlatformAdmin: auth.isPlatformAdmin, companies: [], permissions: [], modules: [], serverTime });
  }

  const companyId = resolveCompany(auth, c.req.header('X-Company-Id') ?? auth.access[0]?.companyId);
  const access = accessFor(auth, companyId);

  const [{ data: company }, { data: subscription }, { data: activeModules }, { data: sites }, { data: employee }, { data: companies }] =
    await Promise.all([
      core.from('companies').select('id, name, code, country, currency, timezone, locale, whatsapp_support').eq('id', companyId).single(),
      core.from('subscriptions').select('status, plan, employee_limit, trial_ends_at').eq('company_id', companyId).maybeSingle(),
      core.from('company_modules').select('module_key').eq('company_id', companyId).eq('active', true),
      core.from('sites').select('id, name, address, lat, lng, radius_m, geofence_mode').eq('company_id', companyId).eq('active', true).order('name'),
      core
        .from('employees')
        .select('id, employee_number, full_name, position, default_site_id, active')
        .eq('company_id', companyId)
        .eq('user_id', auth.userId)
        .maybeSingle(),
      core.from('companies').select('id, name').in('id', [...new Set(auth.access.map((a) => a.companyId))]),
    ]);
  if (!company) throw new HTTPException(404, { message: 'Empresa no encontrada.' });

  const suspended = SUSPENDED.includes(subscription?.status ?? 'trial');
  const modules = suspended ? [] : (activeModules ?? []).map((m) => m.module_key as string);
  const ctx = { env: c.env, auth, companyId, employee: (employee ?? null) as SelfEmployee | null };

  const moduleData = Object.fromEntries(
    await Promise.all(
      MODULE_REGISTRY.filter((m) => m.me && modules.includes(m.key)).map(async (m) => [m.key, await m.me!(ctx)] as const),
    ),
  );

  return c.json({
    userId: auth.userId,
    isPlatformAdmin: auth.isPlatformAdmin,
    role: access?.role ?? (auth.isPlatformAdmin ? 'owner' : undefined),
    permissions: effectivePermissions(auth, companyId, ALL_PERMISSIONS),
    modules,
    company: { ...company, subscription: subscription ?? null },
    companies: companies ?? [],
    sites: sites ?? [],
    employee,
    ...moduleData,
    serverTime,
  });
});
