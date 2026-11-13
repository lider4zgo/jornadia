import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { requireAuth } from '../lib/auth';
import { str } from '../lib/input';
import { adminClient, audit, coreDb } from '../lib/supabase';

/**
 * Mi perfil (administradores): nombre(s), apellidos, fecha de nacimiento, celular y puesto.
 *   GET   /api/core/profile
 *   PATCH /api/core/profile { first_names, last_name_paternal, last_name_maternal, birth_date, mobile, position_title }
 * El puesto que no está en la lista se agrega a los puestos propios de la empresa.
 */
export const profile = new Hono<AppEnv>();
profile.use('*', requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

profile.get('/', async (c) => {
  const auth = c.get('auth');
  const { data } = await coreDb(adminClient(c.env))
    .from('user_profiles')
    .select('first_names, last_name_paternal, last_name_maternal, birth_date, mobile, position_title')
    .eq('user_id', auth.userId)
    .maybeSingle();
  return c.json({ email: auth.email, profile: data ?? null });
});

profile.patch('/', async (c) => {
  const auth = c.get('auth');
  if (auth.isWorker) throw new HTTPException(400, { message: 'Tus datos los actualiza tu empresa desde tu expediente.' });
  const b = await c.req.json<Record<string, unknown>>();
  const row: Record<string, unknown> = { user_id: auth.userId, updated_at: new Date().toISOString() };
  if ('first_names' in b) row.first_names = str(b.first_names, 80) || null;
  if ('last_name_paternal' in b) row.last_name_paternal = str(b.last_name_paternal, 60) || null;
  if ('last_name_maternal' in b) row.last_name_maternal = str(b.last_name_maternal, 60) || null;
  if ('birth_date' in b) {
    const d = str(b.birth_date, 10);
    if (d && (!DATE_RE.test(d) || d < '1900-01-01' || d > new Date().toISOString().slice(0, 10))) {
      throw new HTTPException(400, { message: 'Revisa la fecha de nacimiento.' });
    }
    row.birth_date = d || null;
  }
  if ('mobile' in b) {
    const m = str(b.mobile, 20).replace(/[^\d+]/g, '');
    if (m && m.replace(/\D/g, '').length < 10) throw new HTTPException(400, { message: 'El celular debe tener 10 dígitos.' });
    row.mobile = m || null;
  }
  if ('position_title' in b) row.position_title = str(b.position_title, 80) || null;

  const core = coreDb(adminClient(c.env));
  const { error } = await core.from('user_profiles').upsert(row, { onConflict: 'user_id' });
  if (error) {
    console.error('profile upsert failed', error);
    throw new HTTPException(400, { message: 'No se pudo guardar tu perfil. Revisa los datos.' });
  }

  // Nombre visible en la app (y en los correos) a partir del perfil
  const fullName = [row.first_names, row.last_name_paternal, row.last_name_maternal].filter(Boolean).join(' ');
  if (fullName) await adminClient(c.env).auth.admin.updateUserById(auth.userId, { user_metadata: { full_name: fullName } });

  // Puesto propio: queda disponible para los demás de la empresa
  const companyId = c.req.header('X-Company-Id') ?? auth.access[0]?.companyId;
  const position = typeof row.position_title === 'string' ? row.position_title : '';
  if (position && companyId && auth.access.some((a) => a.companyId === companyId)) {
    const { data: company } = await core.from('companies').select('custom_positions').eq('id', companyId).maybeSingle();
    const list: string[] = company?.custom_positions ?? [];
    if (!list.includes(position)) await core.from('companies').update({ custom_positions: [...list, position].slice(-50) }).eq('id', companyId);
  }
  await audit(c.env, { company_id: companyId ?? null, actor_id: auth.userId, action: 'core.profile.updated', entity: 'core.user_profiles', details: {} });
  return c.json({ ok: true });
});
