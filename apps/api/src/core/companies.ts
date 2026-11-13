import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { INDUSTRIES, isValidCompanyRfc, MODULES, TAX_REGIMES } from '@korporia/core';
import type { AppEnv } from '../env';
import { invalidateAccess, requireAuth, requirePermission } from '../lib/auth';
import { adminClient, audit, coreDb } from '../lib/supabase';
import { EMAIL_RE, str } from '../lib/input';
import { RFC_TAKEN, rfcInUse } from '../lib/rfc';
import { requireRecentCode } from './device';

export const companies = new Hono<AppEnv>();
companies.use('*', requireAuth);

const CODE_RE = /^[a-z0-9]{3,16}$/;
const BILLABLE = MODULES.filter((m) => m.billable).map((m) => m.key as string);

/**
 * Plataforma (Erik): crea una empresa cliente con su usuario propietario.
 * POST /api/core/companies { name, code, owner_email, owner_password, owner_name, employee_limit?, trial_days?, modules? }
 */
companies.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.isPlatformAdmin) throw new HTTPException(403, { message: 'Solo el administrador de la plataforma puede crear empresas.' });
  const b = await c.req.json<Record<string, unknown>>();
  const name = str(b.name);
  const code = str(b.code, 16).toLowerCase();
  const ownerEmail = str(b.owner_email).toLowerCase();
  const ownerPassword = typeof b.owner_password === 'string' ? b.owner_password : '';
  const employeeLimit = Number(b.employee_limit ?? 3);
  const trialDays = Number(b.trial_days ?? 15);
  const modules = Array.isArray(b.modules) ? b.modules.filter((m): m is string => typeof m === 'string') : ['jornada'];

  if (!name || !CODE_RE.test(code)) throw new HTTPException(400, { message: 'Nombre o código inválido (código: 3–16 letras minúsculas o números).' });
  if (!EMAIL_RE.test(ownerEmail) || ownerPassword.length < 8) throw new HTTPException(400, { message: 'Correo o contraseña del propietario inválidos (mínimo 8 caracteres).' });
  if (!Number.isInteger(employeeLimit) || employeeLimit < 1 || employeeLimit > 10000) throw new HTTPException(400, { message: 'Límite de colaboradores inválido.' });
  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) throw new HTTPException(400, { message: 'Días de prueba inválidos.' });
  if (modules.some((m) => !BILLABLE.includes(m))) throw new HTTPException(400, { message: 'Módulo desconocido.' });

  const admin = adminClient(c.env);
  const core = coreDb(admin);
  const { data: taken } = await core.from('companies').select('id').eq('code', code).maybeSingle();
  if (taken) throw new HTTPException(409, { message: 'Ese código de empresa ya existe.' });

  const created = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: { full_name: str(b.owner_name) },
  });
  if (created.error || !created.data.user) {
    throw new HTTPException(400, { message: `No se pudo crear el usuario propietario: ${created.error?.message ?? 'error desconocido'}` });
  }

  // Empresa, suscripción de prueba, módulos y dueño en una sola transacción
  const { data: companyId, error } = await core.rpc('provision_company', {
    p_name: name,
    p_code: code,
    p_owner: created.data.user.id,
    p_employee_limit: employeeLimit,
    p_trial_days: trialDays,
    // RH básico va incluido en todos los planes
    p_modules: [...modules, 'rh'],
  });
  if (error || !companyId) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    if (error?.code === '23505') throw new HTTPException(409, { message: 'Ese código de empresa ya existe.' });
    console.error('provision_company failed', error);
    throw new HTTPException(500, { message: 'No se pudo crear la empresa.' });
  }

  return c.json({ company: { id: companyId, name, code, modules } }, 201);
});

/**
 * Plataforma (Erik): empresas cliente con su plan, para dar de alta a mano a quien
 * contrata Jornada mientras no hay cobro con Stripe.
 * GET /api/core/companies
 */
companies.get('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.isPlatformAdmin) throw new HTTPException(403, { message: 'Solo el administrador de la plataforma.' });
  const core = coreDb(adminClient(c.env));
  const [{ data: list }, { data: subs }, { data: counts }] = await Promise.all([
    core.from('companies').select('id, name, code, created_at, declared_employees').order('created_at', { ascending: false }).limit(500),
    core.from('subscriptions').select('company_id, status, plan, employee_limit, starter_clock_until, starter_hr_until, read_only_at, current_period_end'),
    core.from('employees').select('company_id').eq('active', true),
  ]);
  const subBy = new Map((subs ?? []).map((s) => [s.company_id, s]));
  const active = new Map<string, number>();
  for (const e of counts ?? []) active.set(e.company_id, (active.get(e.company_id) ?? 0) + 1);
  return c.json({
    companies: (list ?? []).map((co) => ({ ...co, subscription: subBy.get(co.id) ?? null, active_employees: active.get(co.id) ?? 0 })),
  });
});

/**
 * Plataforma: cambia el plan de una empresa (cobro manual hasta que haya Stripe).
 * PATCH /api/core/companies/:id/plan { plan: 'jornada', employee_limit, period_end?: 'AAAA-MM-DD' } o { status: 'suspended'|'active' }
 *
 * Al pasar a Jornada se quitan las vigencias de Korporia Starter: el checador y RH básico
 * vuelven a aceptar cambios y la cuenta deja de ir a solo lectura.
 */
companies.patch('/:id/plan', async (c) => {
  const auth = c.get('auth');
  if (!auth.isPlatformAdmin) throw new HTTPException(403, { message: 'Solo el administrador de la plataforma.' });
  const id = c.req.param('id');
  const b = await c.req.json<Record<string, unknown>>();
  const core = coreDb(adminClient(c.env));
  const { data: current } = await core.from('subscriptions').select('*').eq('company_id', id).maybeSingle();
  if (!current) throw new HTTPException(404, { message: 'Empresa no encontrada.' });

  const patch: Record<string, unknown> = {};
  if (b.plan !== undefined) {
    if (b.plan !== 'jornada') throw new HTTPException(400, { message: 'Por ahora solo se contrata Jornada.' });
    const limit = Number(b.employee_limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new HTTPException(400, { message: 'Número de colaboradores inválido.' });
    const periodEnd = typeof b.period_end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.period_end) ? `${b.period_end}T23:59:59-06:00` : null;
    Object.assign(patch, {
      plan: 'jornada',
      status: 'active',
      employee_limit: limit,
      current_period_end: periodEnd,
      read_only_at: null,
      admin_limit: null,
      doc_mb_per_employee: null,
    });
    const { error } = await core.from('company_modules').update({ writable_until: null }).eq('company_id', id).in('module_key', ['jornada', 'rh']);
    if (error) throw new HTTPException(500, { message: 'No se pudieron reactivar los módulos.' });
  }
  if (b.status === 'suspended' || b.status === 'active') patch.status = b.status;
  if (Object.keys(patch).length === 0) throw new HTTPException(400, { message: 'Nada que cambiar.' });

  const { data, error } = await core.from('subscriptions').update(patch).eq('company_id', id).select('*').single();
  if (error) throw new HTTPException(500, { message: 'No se pudo cambiar el plan.' });

  // Los permisos efectivos de todos sus usuarios cambian: se recargan en la siguiente llamada
  const { data: users } = await core.from('memberships').select('user_id').eq('company_id', id);
  for (const u of users ?? []) invalidateAccess(u.user_id);
  await audit(c.env, { company_id: id, actor_id: auth.userId, action: 'subscription.changed', entity: 'core.subscriptions', entity_id: id, details: { antes: current, despues: patch } });
  return c.json({ subscription: data });
});

/**
 * Perfil de la empresa: nombre comercial, datos fiscales, domicilio por partes, teléfono, giro,
 * número de empleados y los datos de contacto del aviso de privacidad de sus trabajadores.
 * GET /api/core/companies/:id/profile · PATCH con cualquiera de esos campos
 */
const PROFILE_FIELDS = 'id, name, code, legal_name, tax_id, tax_regime, address, street, neighborhood, postal_code, city, state, company_phone, industry, declared_employees, custom_positions, custom_industries, privacy_email, privacy_phone';

companies.get('/:id/profile', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  requirePermission(auth, id, 'core.personal.ver', 'core.empresa.editar');
  const { data } = await coreDb(adminClient(c.env)).from('companies').select(PROFILE_FIELDS).eq('id', id).single();
  return c.json({ company: data });
});

companies.patch('/:id/profile', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  requirePermission(auth, id, 'core.empresa.editar');
  const b = await c.req.json<Record<string, unknown>>();
  // RFC y razón social son datos sensibles: si cambian, se pide un código reciente del correo
  if ('legal_name' in b || 'tax_id' in b) {
    const { data: cur } = await coreDb(adminClient(c.env)).from('companies').select('legal_name, tax_id').eq('id', id).single();
    const changed =
      ('legal_name' in b && (str(b.legal_name, 160) || null) !== (cur?.legal_name ?? null)) ||
      ('tax_id' in b && (str(b.tax_id, 13).toUpperCase() || null) !== (cur?.tax_id ?? null));
    if (changed && cur && (cur.legal_name || cur.tax_id)) await requireRecentCode(c);
  }
  const patch: Record<string, unknown> = {};
  if ('legal_name' in b) patch.legal_name = str(b.legal_name, 160) || null;
  if ('tax_id' in b) {
    const rfc = str(b.tax_id, 13).toUpperCase();
    if (rfc && !isValidCompanyRfc(rfc)) throw new HTTPException(400, { message: 'Revisa el RFC: 12 caracteres para persona moral o 13 para persona física.' });
    if (rfc && !auth.isPlatformAdmin && (await rfcInUse(c.env, rfc, id))) throw new HTTPException(409, { message: RFC_TAKEN });
    patch.tax_id = rfc || null;
  }
  if ('tax_regime' in b) {
    const v = str(b.tax_regime, 3);
    if (v && !(v in TAX_REGIMES)) throw new HTTPException(400, { message: 'Régimen fiscal inválido.' });
    patch.tax_regime = v || null;
  }
  if ('name' in b) {
    const name = str(b.name, 120);
    if (name.length < 2) throw new HTTPException(400, { message: 'Escribe el nombre comercial.' });
    patch.name = name;
  }
  if ('street' in b) patch.street = str(b.street, 160) || null;
  if ('neighborhood' in b) patch.neighborhood = str(b.neighborhood, 100) || null;
  if ('postal_code' in b) {
    const cp = str(b.postal_code, 5);
    if (cp && !/^\d{5}$/.test(cp)) throw new HTTPException(400, { message: 'El código postal tiene 5 números.' });
    patch.postal_code = cp || null;
  }
  if ('city' in b) patch.city = str(b.city, 100) || null;
  if ('state' in b) patch.state = str(b.state, 60) || null;
  if ('company_phone' in b) {
    const ph = str(b.company_phone, 20).replace(/[^\d+]/g, '');
    if (ph && ph.replace(/\D/g, '').length < 10) throw new HTTPException(400, { message: 'El teléfono debe tener 10 dígitos.' });
    patch.company_phone = ph || null;
  }
  if ('industry' in b) patch.industry = str(b.industry, 80) || null;
  if ('declared_employees' in b) {
    const n = Number(b.declared_employees);
    if (b.declared_employees != null && b.declared_employees !== '' && (!Number.isInteger(n) || n < 1 || n > 100000)) {
      throw new HTTPException(400, { message: 'Revisa el número de empleados.' });
    }
    patch.declared_employees = b.declared_employees === '' || b.declared_employees == null ? null : n;
  }
  if ('address' in b) patch.address = str(b.address, 300) || null;
  if ('privacy_email' in b) {
    const e = str(b.privacy_email, 254).toLowerCase();
    if (e && !EMAIL_RE.test(e)) throw new HTTPException(400, { message: 'Correo de privacidad inválido.' });
    patch.privacy_email = e || null;
  }
  if ('privacy_phone' in b) patch.privacy_phone = str(b.privacy_phone, 20) || null;
  if (!Object.keys(patch).length) throw new HTTPException(400, { message: 'Nada que guardar.' });
  const core = coreDb(adminClient(c.env));
  // Domicilio armado para el aviso de los trabajadores, a partir de las partes
  const parts = ['street', 'neighborhood', 'postal_code', 'city', 'state'];
  if (parts.some((k) => k in patch)) {
    const { data: cur } = await core.from('companies').select('street, neighborhood, postal_code, city, state, custom_industries').eq('id', id).single();
    const merged = { ...cur, ...patch } as Record<string, string | null>;
    const line = [merged.street, merged.neighborhood ? `Col. ${merged.neighborhood}` : null, merged.postal_code ? `C.P. ${merged.postal_code}` : null, merged.city, merged.state]
      .filter(Boolean)
      .join(', ');
    if (line) patch.address = line;
  }
  // Giro que no está en la lista: se guarda entre los giros propios de la empresa
  if (typeof patch.industry === 'string' && !(INDUSTRIES as readonly string[]).includes(patch.industry)) {
    const { data: cur } = await core.from('companies').select('custom_industries').eq('id', id).single();
    const list: string[] = cur?.custom_industries ?? [];
    if (!list.includes(patch.industry)) patch.custom_industries = [...list, patch.industry].slice(-20);
  }
  const { data, error } = await core
    .from('companies')
    .update(patch)
    .eq('id', id)
    .select(PROFILE_FIELDS)
    .single();
  if (error) throw new HTTPException(500, { message: 'No se pudieron guardar los datos.' });
  await audit(c.env, { company_id: id, actor_id: auth.userId, action: 'company.profile_updated', entity: 'core.companies', entity_id: id, details: patch });
  return c.json({ company: data });
});

/**
 * T-12: empleados activos en un periodo (el máximo de las fotos diarias), base del límite
 * de Starter y del cobro por rango.
 * GET /api/core/companies/:id/active-employees?from=2027-01-01&to=2027-01-31 (por omisión, el mes en curso)
 */
companies.get('/:id/active-employees', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  requirePermission(auth, id, 'core.personal.ver', 'core.empresa.editar', 'core.empresa.suscripcion');
  const today = new Date().toISOString().slice(0, 10);
  const from = c.req.query('from') ?? `${today.slice(0, 7)}-01`;
  const to = c.req.query('to') ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new HTTPException(400, { message: 'Indica un periodo válido.' });
  }
  const { data, error } = await coreDb(adminClient(c.env)).rpc('active_employees_in_period', { p_company: id, p_from: from, p_to: to });
  if (error) throw new HTTPException(500, { message: 'No se pudo contar el personal.' });
  return c.json({ from, to, activeEmployees: Number(data ?? 0) });
});
