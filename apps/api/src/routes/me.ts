import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { allowedNextKinds } from '@jornadia/core';
import type { AppEnv } from '../env';
import { requireAuth, resolveCompany } from '../auth';
import { adminClient } from '../supabase';

export const me = new Hono<AppEnv>();
me.use('*', requireAuth);

/** Todo lo que la app necesita al abrir: empresa, rol, obras, última checada y referencia facial. */
me.get('/', async (c) => {
  const auth = c.get('auth');
  const admin = adminClient(c.env);

  if (auth.memberships.length === 0) {
    return c.json({ userId: auth.userId, isPlatformAdmin: auth.isPlatformAdmin, companies: [], serverTime: new Date().toISOString() });
  }

  const companyId = resolveCompany(auth, c.req.header('X-Company-Id') ?? auth.memberships[0]?.company_id);
  const role = auth.memberships.find((m) => m.company_id === companyId)?.role ?? 'owner';

  const [{ data: company }, { data: sites }, { data: employee }, { data: companies }] = await Promise.all([
    admin
      .from('companies')
      .select('id, name, code, status, plan, employee_limit, trial_ends_at, timezone, weekly_hour_limit, face_match_threshold, whatsapp_support, track_breaks')
      .eq('id', companyId)
      .single(),
    admin.from('sites').select('id, name, address, lat, lng, radius_m, geofence_mode').eq('company_id', companyId).eq('active', true).order('name'),
    admin
      .from('employees')
      .select('id, employee_number, full_name, position, default_site_id, consent_confirmed_at, active')
      .eq('company_id', companyId)
      .eq('user_id', auth.userId)
      .maybeSingle(),
    admin.from('companies').select('id, name').in('id', [...new Set(auth.memberships.map((m) => m.company_id))]),
  ]);
  if (!company) throw new HTTPException(404, { message: 'Empresa no encontrada.' });

  let lastPunch = null;
  let face = null;
  if (employee) {
    const [last, faceRow] = await Promise.all([
      admin
        .from('punches')
        .select('id, kind, server_ts, site_id')
        .eq('employee_id', employee.id)
        .order('server_ts', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from('employee_faces').select('descriptor, model_version, enrolled_at, approved_at').eq('employee_id', employee.id).maybeSingle(),
    ]);
    lastPunch = last.data;
    face = faceRow.data;
  }

  return c.json({
    userId: auth.userId,
    isPlatformAdmin: auth.isPlatformAdmin,
    role,
    company,
    companies: companies ?? [],
    sites: sites ?? [],
    employee,
    lastPunch,
    nextKinds: allowedNextKinds(lastPunch?.kind ?? null),
    face,
    serverTime: new Date().toISOString(),
  });
});

// La foto de registro ya no la toma el propio trabajador: la toma un supervisor o
// administrador en persona (POST /api/admin/employees/:id/face).
