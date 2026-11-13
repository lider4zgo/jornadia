import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { mexicanHolidays } from '@korporia/core';
import type { AppEnv } from '../../env';
import { requirePermission, resolveCompany } from '../../lib/auth';
import { str } from '../../lib/input';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, audit, rhDb } from '../../lib/supabase';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Días propios de la empresa en un rango (se suman a los festivos oficiales al contar días hábiles). */
export async function companyDaysBetween(client: SupabaseClient, companyId: string, from: string, to: string): Promise<string[]> {
  const { data } = await rhDb(client).from('company_days').select('day').eq('company_id', companyId).gte('day', from).lte('day', to);
  return (data ?? []).map((d) => d.day as string);
}

/**
 * ORG-05: calendario laboral. Los días de descanso obligatorio de la LFT (art. 74) se calculan
 * solos; la empresa agrega sus propios días de descanso o festivos.
 *   GET    /api/rh/calendar?year=2027
 *   POST   /api/rh/calendar { day, name, kind? }
 *   DELETE /api/rh/calendar/:day
 */
export const calendar = new Hono<AppEnv>();

calendar.get('/calendar', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.estructura.gestionar', 'rh.expediente.ver', 'rh.ausencias.ver', 'rh.portal.ver', 'core.personal.ver');
  const year = Number(c.req.query('year') ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new HTTPException(400, { message: 'Año inválido.' });
  const { data } = await rhDb(adminClient(c.env))
    .from('company_days')
    .select('day, kind, name')
    .eq('company_id', companyId)
    .gte('day', `${year}-01-01`)
    .lte('day', `${year}-12-31`)
    .order('day');
  return c.json({ year, official: mexicanHolidays(year), company: data ?? [] });
});

calendar.post('/calendar', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.estructura.gestionar');
  const b = await c.req.json<Record<string, unknown>>();
  const day = str(b.day, 10);
  const name = str(b.name, 80);
  const kind = b.kind === 'festivo' ? 'festivo' : 'descanso';
  if (!DATE_RE.test(day) || Number.isNaN(Date.parse(day))) throw new HTTPException(400, { message: 'Elige una fecha válida.' });
  if (name.length < 2) throw new HTTPException(400, { message: 'Escribe el nombre del día.' });
  if (mexicanHolidays(Number(day.slice(0, 4))).some((h) => h.date === day)) {
    throw new HTTPException(409, { message: 'Ese día ya es de descanso obligatorio por ley.' });
  }
  const { error } = await rhDb(adminClient(c.env)).from('company_days').upsert({ company_id: companyId, day, kind, name }, { onConflict: 'company_id,day' });
  if (error) throw new HTTPException(500, { message: 'No se pudo guardar el día.' });
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: 'rh.calendar.day_saved', entity: 'rh.company_days', details: { day, kind, name } });
  return c.json({ ok: true }, 201);
});

calendar.delete('/calendar/:day', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'rh.estructura.gestionar');
  const day = c.req.param('day');
  if (!DATE_RE.test(day)) throw new HTTPException(400, { message: 'Fecha inválida.' });
  await rhDb(adminClient(c.env)).from('company_days').delete().eq('company_id', companyId).eq('day', day);
  await audit(c.env, { company_id: companyId, actor_id: auth.userId, action: 'rh.calendar.day_removed', entity: 'rh.company_days', details: { day } });
  return c.json({ ok: true });
});
