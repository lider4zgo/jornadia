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
      .select('id, name, code, status, plan, employee_limit, trial_ends_at, timezone, weekly_hour_limit, face_match_threshold, whatsapp_support')
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

/**
 * Alta de la referencia facial del propio trabajador (primera vez).
 * Cuerpo multipart: data → { descriptor: number[], model_version }, photo → imagen.
 * Cambiarla después requiere que un administrador borre la anterior.
 */
me.post('/face', async (c) => {
  const auth = c.get('auth');
  const admin = adminClient(c.env);
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  const body = await c.req.parseBody();

  const { data: employee } = await admin
    .from('employees')
    .select('id, active')
    .eq('company_id', companyId)
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (!employee?.active) throw new HTTPException(403, { message: 'Tu usuario no está registrado como trabajador activo.' });

  const { data: current } = await admin.from('employee_faces').select('employee_id').eq('employee_id', employee.id).maybeSingle();
  if (current) throw new HTTPException(409, { message: 'Ya tienes una foto registrada. Pide a tu administrador que la reinicie.' });

  let data: { descriptor?: unknown; model_version?: unknown };
  try {
    data = JSON.parse(String(body.data ?? ''));
  } catch {
    throw new HTTPException(400, { message: 'Datos inválidos.' });
  }
  const descriptor = data.descriptor;
  if (
    !Array.isArray(descriptor) ||
    descriptor.length < 64 ||
    descriptor.length > 2048 ||
    !descriptor.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    throw new HTTPException(400, { message: 'Descriptor facial inválido.' });
  }
  const photo = body.photo;
  if (!(photo instanceof File) || !['image/jpeg', 'image/webp'].includes(photo.type) || photo.size > 400 * 1024) {
    throw new HTTPException(400, { message: 'Foto inválida.' });
  }

  const photoPath = `faces/${companyId}/${employee.id}/${Date.now()}.jpg`;
  await c.env.FILES.put(photoPath, await photo.arrayBuffer(), { httpMetadata: { contentType: photo.type } });

  const { error } = await admin.from('employee_faces').insert({
    employee_id: employee.id,
    company_id: companyId,
    descriptor,
    photo_path: photoPath,
    model_version: String(data.model_version ?? 'unknown').slice(0, 64),
  });
  if (error) {
    await c.env.FILES.delete(photoPath);
    throw new HTTPException(500, { message: 'No se pudo guardar tu foto. Intenta de nuevo.' });
  }
  await admin.from('audit_log').insert({
    company_id: companyId,
    actor_id: auth.userId,
    action: 'face.enrolled',
    entity: 'employee_faces',
    entity_id: employee.id,
  });
  return c.json({ ok: true }, 201);
});
