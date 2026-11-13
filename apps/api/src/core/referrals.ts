import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { normalizeOrigin } from '@korporia/core';
import type { AppEnv } from '../env';
import { requireAuth } from '../lib/auth';
import { EMAIL_RE, str } from '../lib/input';
import { adminClient, audit, coreDb } from '../lib/supabase';

/**
 * Enlaces con código para despachos contables y campañas (solo el administrador de la plataforma).
 * El enlace es korporia.com/?origen=<código>; el código queda en cada registro y en la lista de espera.
 *   GET  /api/core/referrals            códigos con sus registros y altas en la lista de espera
 *   POST /api/core/referrals { name, code?, kind?, contact_email?, notes? }
 */
export const referrals = new Hono<AppEnv>();
referrals.use('*', requireAuth);
referrals.use('*', async (c, next) => {
  if (!c.get('auth').isPlatformAdmin) throw new HTTPException(403, { message: 'Solo el administrador de la plataforma.' });
  await next();
});

referrals.get('/', async (c) => {
  const core = coreDb(adminClient(c.env));
  const [{ data: codes }, { data: companies }, { data: waitlist }] = await Promise.all([
    core.from('referral_codes').select('code, kind, name, contact_email, notes, active, created_at').order('created_at', { ascending: false }),
    core.from('companies').select('signup_origin').not('signup_origin', 'is', null).limit(10000),
    core.from('waitlist').select('origin').not('origin', 'is', null).limit(10000),
  ]);
  const count = (rows: { [k: string]: unknown }[] | null, key: string) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
    return m;
  };
  const signups = count(companies, 'signup_origin');
  const waits = count(waitlist, 'origin');
  const known = new Set((codes ?? []).map((r) => r.code));
  // Orígenes sin código dado de alta (por ejemplo, el QR de la guía: guia-reforma)
  const others = [...new Set([...signups.keys(), ...waits.keys()])]
    .filter((o) => !known.has(o))
    .map((o) => ({ origin: o, signups: signups.get(o) ?? 0, waitlist: waits.get(o) ?? 0 }));
  return c.json({
    codes: (codes ?? []).map((r) => ({ ...r, link: `https://korporia.com/?origen=${r.code}`, signups: signups.get(r.code) ?? 0, waitlist: waits.get(r.code) ?? 0 })),
    others,
  });
});

referrals.post('/', async (c) => {
  const auth = c.get('auth');
  const b = await c.req.json<Record<string, unknown>>();
  const name = str(b.name, 120);
  if (name.length < 2) throw new HTTPException(400, { message: 'Escribe el nombre del despacho.' });
  const kind = b.kind === 'campana' ? 'campana' : 'despacho';
  const email = str(b.contact_email, 254).toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new HTTPException(400, { message: 'Correo inválido.' });
  // Código legible: d-<nombre corto> para despachos; si está ocupado, se le agrega un número
  const base = normalizeOrigin(b.code) ?? normalizeOrigin(`${kind === 'despacho' ? 'd-' : ''}${name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-')}`.slice(0, 30));
  if (!base) throw new HTTPException(400, { message: 'Código inválido.' });
  const core = coreDb(adminClient(c.env));
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = attempt === 0 ? base : `${base.slice(0, 34)}-${Math.floor(10 + Math.random() * 990)}`;
    const { error } = await core.from('referral_codes').insert({ code, kind, name, contact_email: email || null, notes: str(b.notes, 300) || null });
    if (!error) {
      await audit(c.env, { company_id: null, actor_id: auth.userId, action: 'core.referral.created', entity: 'core.referral_codes', details: { code, kind, name } });
      return c.json({ code, link: `https://korporia.com/?origen=${code}` }, 201);
    }
    if (error.code !== '23505') {
      console.error('referral insert failed', error);
      throw new HTTPException(500, { message: 'No se pudo crear el código.' });
    }
  }
  throw new HTTPException(409, { message: 'Ese código ya existe. Elige otro.' });
});
