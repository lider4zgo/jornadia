import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { companyCodeFromName, isValidCompanyRfc, LEGAL_VERSIONS, normalizeOrigin, STARTER, STARTER_LIMITS } from '@korporia/core';
import type { AppEnv } from '../env';
import { invalidateAccess, requireAuth } from '../lib/auth';
import { EMAIL_RE, str } from '../lib/input';
import { RFC_TAKEN, rfcInUse } from '../lib/rfc';
import { passwordProblem } from './device';
import { adminClient, audit, coreDb } from '../lib/supabase';

/**
 * Registro por autoservicio (Korporia Starter), Erik 13 nov 2026.
 *  1. POST /api/core/signup/start    { email, password, accept_terms } crea la cuenta. La app entra
 *                                    con la contraseña y el segundo paso manda el código al correo:
 *                                    así se confirma el correo.
 *  2. POST /api/core/signup/complete con la sesión verificada: nombre de la empresa, RFC y número
 *                                    de empleados; crea la empresa en Korporia Starter y registra la
 *                                    aceptación de términos y aviso. Lo demás se completa en los perfiles.
 * Con Google o Microsoft se entra directo y se llega igual al paso 2.
 */
export const signup = new Hono<AppEnv>();

signup.post('/start', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const email = str(b.email, 254).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  if (!EMAIL_RE.test(email)) throw new HTTPException(400, { message: 'Escribe un correo válido.' });
  if (email.endsWith(`@${c.env.WORKER_EMAIL_DOMAIN}`) || email.endsWith(`.${c.env.WORKER_EMAIL_DOMAIN}`)) {
    throw new HTTPException(400, { message: 'Escribe un correo válido.' });
  }
  const problem = passwordProblem(password);
  if (problem) throw new HTTPException(400, { message: problem });
  if (b.accept_terms !== true) throw new HTTPException(400, { message: 'Para continuar, acepta los términos y el aviso de privacidad.' });

  // El correo se confirma con el código de 6 dígitos al entrar por primera vez (segundo paso):
  // sin ese código la cuenta no ve ni crea nada.
  const created = await adminClient(c.env).auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) {
    if (/already|registered|exists/i.test(created.error.message)) {
      throw new HTTPException(409, { message: 'Ya hay una cuenta con este correo. Inicia sesión o usa "¿Olvidaste tu contraseña?".' });
    }
    console.error('signup createUser failed', created.error);
    throw new HTTPException(400, {
      message: /weak|pwned|leak/i.test(created.error.message) ? 'Esa contraseña es demasiado común. Elige otra.' : 'No pudimos crear tu cuenta. Intenta de nuevo.',
    });
  }
  return c.json({ ok: true }, 201);
});

signup.post('/complete', requireAuth, async (c) => {
  const auth = c.get('auth');
  if (auth.access.length > 0) throw new HTTPException(409, { message: 'Tu usuario ya tiene una empresa en Korporia.' });

  const b = await c.req.json<Record<string, unknown>>();
  const companyName = str(b.company_name, 120);
  const fullName = str(b.full_name, 120);
  const employees = Number(b.employees);
  const industry = str(b.industry, 60);
  const state = str(b.state, 60);
  const rfc = str(b.rfc, 13).toUpperCase();
  const origin = normalizeOrigin(b.origin);
  if (companyName.length < 2) throw new HTTPException(400, { message: 'Escribe el nombre de tu empresa.' });
  if (!Number.isInteger(employees) || employees < 1) throw new HTTPException(400, { message: 'Escribe cuántos empleados tiene tu empresa.' });
  if (employees > STARTER.maxEmployees) {
    throw new HTTPException(400, {
      message: `Korporia Starter es para equipos de hasta ${STARTER.maxEmployees} empleados. Escríbenos por WhatsApp y te ayudamos a empezar con Jornada.`,
    });
  }
  // T-08: una cuenta Starter por empresa, con su RFC
  if (!isValidCompanyRfc(rfc)) throw new HTTPException(400, { message: 'Escribe el RFC de tu empresa: 12 caracteres para persona moral o 13 para persona física.' });
  if (b.accept_terms !== true) throw new HTTPException(400, { message: 'Para continuar, acepta los términos y el aviso de privacidad.' });
  if (b.terms_version !== LEGAL_VERSIONS.terminos || b.privacy_version !== LEGAL_VERSIONS.privacidad) {
    throw new HTTPException(409, { message: 'Los términos se actualizaron. Recarga la página para ver la versión vigente.' });
  }

  if (await rfcInUse(c.env, rfc)) throw new HTTPException(409, { message: RFC_TAKEN });

  const admin = adminClient(c.env);
  const core = coreDb(admin);

  // Código corto para que los colaboradores entren; si está ocupado, se le agrega un número
  const base = companyCodeFromName(companyName);
  let companyId: string | null = null;
  let code = base;
  for (let attempt = 0; attempt < 6 && !companyId; attempt++) {
    code = attempt === 0 ? base : `${base.slice(0, 12)}${Math.floor(10 + Math.random() * 9990)}`;
    const { data, error } = await core.rpc('provision_company', {
      p_name: companyName,
      p_code: code,
      p_owner: auth.userId,
      p_employee_limit: STARTER.maxEmployees,
      p_trial_days: STARTER.clockDays,
      p_modules: ['jornada', 'rh'],
    });
    if (!error && data) companyId = data as string;
    else if (error?.code !== '23505') {
      console.error('signup provision_company failed', error);
      throw new HTTPException(500, { message: 'No pudimos crear tu empresa. Intenta de nuevo.' });
    }
  }
  if (!companyId) throw new HTTPException(500, { message: 'No pudimos crear tu empresa. Intenta de nuevo.' });

  const now = new Date();
  const clockUntil = new Date(now.getTime() + STARTER.clockDays * 864e5);
  const hrUntil = new Date(now);
  hrUntil.setMonth(hrUntil.getMonth() + STARTER.hrMonths);

  const ip = c.req.header('CF-Connecting-IP') ?? null;
  const userAgent = (c.req.header('User-Agent') ?? '').slice(0, 300) || null;
  const results = await Promise.all([
    core
      .from('subscriptions')
      .update({
        plan: 'starter',
        status: 'trial',
        starter_started_at: now.toISOString(),
        starter_clock_until: clockUntil.toISOString(),
        starter_hr_until: hrUntil.toISOString(),
        trial_ends_at: clockUntil.toISOString(),
        // Al mes 6 toda la cuenta pasa a solo lectura (90 días con exportación, luego archivo)
        read_only_at: hrUntil.toISOString(),
        admin_limit: STARTER_LIMITS.admins,
        doc_mb_per_employee: STARTER_LIMITS.docMbPerEmployee,
        doc_max_file_mb: STARTER_LIMITS.docMaxFileMb,
      })
      .eq('company_id', companyId),
    // Checador hasta el día 90 y RH básico hasta el mes 6; después, solo lectura
    core.from('company_modules').update({ writable_until: clockUntil.toISOString() }).eq('company_id', companyId).eq('module_key', 'jornada'),
    core.from('company_modules').update({ writable_until: hrUntil.toISOString() }).eq('company_id', companyId).eq('module_key', 'rh'),
    core.from('companies').update({ declared_employees: employees, industry: industry || null, state: state || null, tax_id: rfc, signup_origin: origin }).eq('id', companyId),
    core.from('legal_acceptances').insert([
      { company_id: companyId, user_id: auth.userId, document: 'terminos', version: LEGAL_VERSIONS.terminos, ip, user_agent: userAgent },
      { company_id: companyId, user_id: auth.userId, document: 'privacidad', version: LEGAL_VERSIONS.privacidad, ip, user_agent: userAgent },
    ]),
    fullName ? admin.auth.admin.updateUserById(auth.userId, { user_metadata: { full_name: fullName } }) : Promise.resolve({ error: null }),
  ]);
  for (const r of results) if (r.error) console.error('signup complete step failed', r.error);

  // Quien no quiere novedades lo deja dicho desde el registro (finalidades opcionales del aviso)
  if (b.marketing_opt_out === true) {
    const { data: user } = await admin.auth.admin.getUserById(auth.userId);
    if (user.user?.email) {
      await core.from('waitlist').upsert(
        { email: user.user.email.toLowerCase(), marketing_opt_out: true, source: 'registro', ...(origin ? { origin } : {}), consent_version: LEGAL_VERSIONS.privacidad, company_id: companyId },
        { onConflict: 'email' },
      );
    }
  }

  invalidateAccess(auth.userId);
  await audit(c.env, {
    company_id: companyId,
    actor_id: auth.userId,
    action: 'company.signup',
    entity: 'core.companies',
    entity_id: companyId,
    details: { plan: 'starter', employees, industry, state, origin, terms: LEGAL_VERSIONS.terminos },
  });

  return c.json({ company: { id: companyId, name: companyName, code } }, 201);
});

/**
 * Lista de espera de Despegue, Full y módulos "Próximamente" (desde la landing, sin sesión).
 * POST /api/core/waitlist { email, lang?, marketing_opt_out?, source?, origin? }
 */
export const waitlist = new Hono<AppEnv>();

waitlist.post('/', async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const email = str(b.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HTTPException(400, { message: 'Escribe un correo válido.' });
  const { error } = await coreDb(adminClient(c.env))
    .from('waitlist')
    .upsert(
      {
        email,
        lang: b.lang === 'en' ? 'en' : 'es',
        marketing_opt_out: b.marketing_opt_out === true,
        source: str(b.source, 30) || 'landing',
        // Se conserva el primer origen si la persona vuelve a anotarse sin él
        ...(normalizeOrigin(b.origin) ? { origin: normalizeOrigin(b.origin) } : {}),
        consent_version: LEGAL_VERSIONS.listaEspera,
      },
      { onConflict: 'email' },
    );
  if (error) {
    console.error('waitlist upsert failed', error);
    throw new HTTPException(500, { message: 'No pudimos guardar tu correo. Intenta de nuevo.' });
  }
  return c.json({ ok: true }, 201);
});
