import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Role } from '../env';
import { requireAuth, requireRole } from '../auth';
import { adminClient, workerEmail } from '../supabase';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('*', requireAuth);

const CODE_RE = /^[a-z0-9]{3,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const randomSecret = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, '') + 'Aa1!';
};

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Superadmin (Erik): crea una empresa cliente con su usuario propietario.
 * POST /api/admin/companies { name, code, owner_email, owner_password, owner_name, employee_limit?, trial_days? }
 */
adminRoutes.post('/companies', async (c) => {
  const auth = c.get('auth');
  if (!auth.isPlatformAdmin) throw new HTTPException(403, { message: 'Solo el administrador de la plataforma puede crear empresas.' });
  const b = await c.req.json<Record<string, unknown>>();
  const name = str(b.name);
  const code = str(b.code, 16).toLowerCase();
  const ownerEmail = str(b.owner_email).toLowerCase();
  const ownerPassword = typeof b.owner_password === 'string' ? b.owner_password : '';
  const employeeLimit = Number(b.employee_limit ?? 3);
  const trialDays = Number(b.trial_days ?? 15);
  if (!name || !CODE_RE.test(code)) throw new HTTPException(400, { message: 'Nombre o código inválido (código: 3–16 letras minúsculas o números).' });
  if (!EMAIL_RE.test(ownerEmail) || ownerPassword.length < 8) throw new HTTPException(400, { message: 'Correo o contraseña del propietario inválidos (mínimo 8 caracteres).' });
  if (!Number.isInteger(employeeLimit) || employeeLimit < 1 || employeeLimit > 10000) throw new HTTPException(400, { message: 'Límite de empleados inválido.' });

  const admin = adminClient(c.env);
  const { data: company, error } = await admin
    .from('companies')
    .insert({
      name,
      code,
      employee_limit: employeeLimit,
      trial_ends_at: new Date(Date.now() + trialDays * 86_400_000).toISOString(),
    })
    .select('id, name, code')
    .single();
  if (error) {
    if (error.code === '23505') throw new HTTPException(409, { message: 'Ese código de empresa ya existe.' });
    throw new HTTPException(500, { message: 'No se pudo crear la empresa.' });
  }

  const created = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: { full_name: str(b.owner_name) },
  });
  if (created.error || !created.data.user) {
    await admin.from('companies').delete().eq('id', company.id);
    throw new HTTPException(400, { message: `No se pudo crear el usuario propietario: ${created.error?.message ?? 'error desconocido'}` });
  }
  await admin.from('memberships').insert({ company_id: company.id, user_id: created.data.user.id, role: 'owner' });
  await admin.from('audit_log').insert({
    company_id: company.id,
    actor_id: auth.userId,
    action: 'company.created',
    entity: 'companies',
    entity_id: company.id,
  });
  return c.json({ company }, 201);
});

/**
 * Dueño o admin: da de alta a una persona.
 *  - role 'worker' (por defecto): cuenta con número de empleado + NIP de 6 dígitos.
 *  - role 'supervisor' | 'admin': cuenta con correo y contraseña (admin solo lo crea el dueño).
 * POST /api/admin/employees { company_id, employee_number, full_name, role?, email?, password?,
 *                             phone?, position?, default_site_id?, site_ids?, consent_confirmed? }
 */
adminRoutes.post('/employees', async (c) => {
  const auth = c.get('auth');
  const b = await c.req.json<Record<string, unknown>>();
  const companyId = str(b.company_id, 36);
  const role = (str(b.role, 20) || 'worker') as Role;
  if (!['worker', 'supervisor', 'admin'].includes(role)) throw new HTTPException(400, { message: 'Rol inválido.' });
  requireRole(auth, companyId, role === 'admin' ? ['owner'] : ['owner', 'admin']);

  const employeeNumber = str(b.employee_number, 20);
  const fullName = str(b.full_name);
  if (!employeeNumber || !/^[A-Za-z0-9-]+$/.test(employeeNumber) || !fullName) {
    throw new HTTPException(400, { message: 'Número de empleado (letras, números o guion) y nombre son obligatorios.' });
  }

  const admin = adminClient(c.env);
  const { data: company } = await admin.from('companies').select('id, code, employee_limit').eq('id', companyId).single();
  if (!company) throw new HTTPException(404, { message: 'Empresa no encontrada.' });

  const isWorker = role === 'worker';
  if (isWorker) {
    const { count } = await admin.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('active', true);
    if ((count ?? 0) >= company.employee_limit) {
      throw new HTTPException(402, { message: `Tu plan permite ${company.employee_limit} trabajadores activos. Cambia de paquete para agregar más.` });
    }
  }

  let email: string;
  let password: string;
  if (isWorker) {
    // El trabajador no usa contraseña: entra con código + número y lo protege la selfie.
    // La cuenta lleva una contraseña aleatoria que nadie conoce.
    password = randomSecret();
    email = workerEmail(employeeNumber, company.code, c.env.WORKER_EMAIL_DOMAIN);
  } else {
    email = str(b.email).toLowerCase();
    password = typeof b.password === 'string' ? b.password : '';
    if (!EMAIL_RE.test(email) || password.length < 8) throw new HTTPException(400, { message: 'Correo o contraseña inválidos (mínimo 8 caracteres).' });
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, company_id: companyId, employee_number: employeeNumber },
  });
  if (created.error || !created.data.user) {
    const msg = created.error?.message?.includes('already') ? 'Ya existe una cuenta con ese número o correo.' : 'No se pudo crear la cuenta.';
    throw new HTTPException(409, { message: msg });
  }
  const userId = created.data.user.id;

  const { data: membership, error: mErr } = await admin
    .from('memberships')
    .insert({ company_id: companyId, user_id: userId, role })
    .select('id')
    .single();

  let employee = null;
  let eErr = null;
  if (!mErr && isWorker) {
    const res = await admin
      .from('employees')
      .insert({
        company_id: companyId,
        user_id: userId,
        employee_number: employeeNumber,
        full_name: fullName,
        phone: str(b.phone, 20) || null,
        position: str(b.position, 80) || null,
        default_site_id: str(b.default_site_id, 36) || null,
        consent_confirmed_at: b.consent_confirmed === true ? new Date().toISOString() : null,
        consent_confirmed_by: b.consent_confirmed === true ? auth.userId : null,
      })
      .select('id, employee_number, full_name')
      .single();
    employee = res.data;
    eErr = res.error;
  }

  if (mErr || eErr) {
    await admin.auth.admin.deleteUser(userId);
    const dup = (eErr ?? mErr)?.code === '23505';
    throw new HTTPException(dup ? 409 : 500, { message: dup ? 'Ese número de empleado ya existe.' : 'No se pudo completar el alta.' });
  }

  if (role === 'supervisor' && Array.isArray(b.site_ids) && membership) {
    const rows = b.site_ids.filter((s): s is string => typeof s === 'string').map((site_id) => ({ membership_id: membership.id, site_id }));
    if (rows.length) await admin.from('supervisor_sites').insert(rows);
  }

  await admin.from('audit_log').insert({
    company_id: companyId,
    actor_id: auth.userId,
    action: `member.created.${role}`,
    entity: isWorker ? 'employees' : 'memberships',
    entity_id: employee?.id ?? membership?.id ?? null,
  });

  return c.json({ employee, role, login: isWorker ? { company_code: company.code, employee_number: employeeNumber } : { email } }, 201);
});

/** Dueño o admin: borra la foto de registro para tomarla de nuevo. */
adminRoutes.delete('/employees/:id/face', async (c) => {
  const auth = c.get('auth');
  const admin = adminClient(c.env);
  const { data: face } = await admin.from('employee_faces').select('employee_id, company_id, photo_path').eq('employee_id', c.req.param('id')).maybeSingle();
  if (!face) throw new HTTPException(404, { message: 'El trabajador no tiene foto registrada.' });
  requireRole(auth, face.company_id, ['owner', 'admin']);
  await admin.from('employee_faces').delete().eq('employee_id', face.employee_id);
  await admin.from('employees').update({ face_enrolled_at: null }).eq('id', face.employee_id);
  await c.env.FILES.delete(face.photo_path);
  await admin.from('audit_log').insert({ company_id: face.company_id, actor_id: auth.userId, action: 'face.reset', entity: 'employee_faces', entity_id: face.employee_id });
  return c.json({ ok: true });
});

/**
 * Foto de registro tomada EN PERSONA por un supervisor o administrador, desde su
 * propio celular y frente al trabajador. Cuerpo multipart:
 *   data  → { descriptor: number[], model_version, liveness_passed }
 *   photo → imagen JPEG/WebP (≤ 400 KB)
 */
adminRoutes.post('/employees/:id/face', async (c) => {
  const auth = c.get('auth');
  const admin = adminClient(c.env);
  const { data: employee } = await admin
    .from('employees')
    .select('id, company_id, full_name, active, face_enrolled_at')
    .eq('id', c.req.param('id'))
    .maybeSingle();
  if (!employee) throw new HTTPException(404, { message: 'Trabajador no encontrado.' });
  requireRole(auth, employee.company_id, ['owner', 'admin', 'supervisor']);
  if (!employee.active) throw new HTTPException(400, { message: 'El trabajador está dado de baja.' });
  if (employee.face_enrolled_at) {
    throw new HTTPException(409, { message: 'Este trabajador ya tiene foto de registro. Un administrador debe borrarla antes de tomar otra.' });
  }

  const body = await c.req.parseBody();
  let data: { descriptor?: unknown; model_version?: unknown; liveness_passed?: unknown };
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
    throw new HTTPException(400, { message: 'No se pudo leer el rostro. Toma la foto de nuevo.' });
  }
  if (data.liveness_passed !== true) {
    throw new HTTPException(422, { message: 'No se confirmó que la persona esté frente a la cámara. Toma la foto de nuevo con buena luz.' });
  }
  const photo = body.photo;
  if (!(photo instanceof File) || !['image/jpeg', 'image/webp'].includes(photo.type) || photo.size > 400 * 1024) {
    throw new HTTPException(400, { message: 'Foto inválida.' });
  }

  const photoPath = `faces/${employee.company_id}/${employee.id}/${Date.now()}.jpg`;
  await c.env.FILES.put(photoPath, await photo.arrayBuffer(), { httpMetadata: { contentType: photo.type } });

  const now = new Date().toISOString();
  const { error } = await admin.from('employee_faces').insert({
    employee_id: employee.id,
    company_id: employee.company_id,
    descriptor,
    photo_path: photoPath,
    model_version: String(data.model_version ?? 'unknown').slice(0, 64),
    enrolled_at: now,
    enrolled_by: auth.userId,
    approved_at: now,
    approved_by: auth.userId,
  });
  if (error) {
    await c.env.FILES.delete(photoPath);
    throw new HTTPException(error.code === '23505' ? 409 : 500, {
      message: error.code === '23505' ? 'Este trabajador ya tiene foto de registro.' : 'No se pudo guardar la foto. Intenta de nuevo.',
    });
  }
  await admin.from('employees').update({ face_enrolled_at: now }).eq('id', employee.id);
  await admin.from('audit_log').insert({
    company_id: employee.company_id,
    actor_id: auth.userId,
    action: 'face.enrolled_in_person',
    entity: 'employee_faces',
    entity_id: employee.id,
  });
  return c.json({ ok: true, enrolled_at: now }, 201);
});
