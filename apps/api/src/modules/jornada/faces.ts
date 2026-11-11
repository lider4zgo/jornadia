import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../../env';
import { requireAuth, requirePermission } from '../../lib/auth';
import { adminClient, audit, coreDb, jornadaDb } from '../../lib/supabase';

/** Foto de registro (referencia biométrica) de cada colaborador. */
export const faces = new Hono<AppEnv>();
faces.use('*', requireAuth);

/** Borra la foto de registro para tomarla de nuevo. */
faces.delete('/:id/face', async (c) => {
  const auth = c.get('auth');
  const db = jornadaDb(adminClient(c.env));
  const { data: face } = await db.from('faces').select('employee_id, company_id, photo_path').eq('employee_id', c.req.param('id')).maybeSingle();
  if (!face) throw new HTTPException(404, { message: 'El colaborador no tiene foto registrada.' });
  requirePermission(auth, face.company_id, 'jornada.rostros.restablecer');
  await db.from('faces').delete().eq('employee_id', face.employee_id);
  await db.from('employee_settings').update({ face_enrolled_at: null }).eq('employee_id', face.employee_id);
  await c.env.FILES.delete(face.photo_path);
  await audit(c.env, { company_id: face.company_id, actor_id: auth.userId, action: 'jornada.face.reset', entity: 'jornada.faces', entity_id: face.employee_id });
  return c.json({ ok: true });
});

/**
 * Foto de registro tomada EN PERSONA por un supervisor o administrador, desde su
 * propio celular y frente al colaborador. Cuerpo multipart:
 *   data  → { descriptor: number[], model_version, liveness_passed }
 *   photo → imagen JPEG/WebP (≤ 400 KB)
 */
faces.post('/:id/face', async (c) => {
  const auth = c.get('auth');
  const admin = adminClient(c.env);
  const db = jornadaDb(admin);
  const { data: employee } = await coreDb(admin).from('employees').select('id, company_id, full_name, active').eq('id', c.req.param('id')).maybeSingle();
  if (!employee) throw new HTTPException(404, { message: 'Colaborador no encontrado.' });
  requirePermission(auth, employee.company_id, 'jornada.rostros.registrar');
  if (!employee.active) throw new HTTPException(400, { message: 'El colaborador está dado de baja.' });

  const { data: existing } = await db.from('faces').select('employee_id').eq('employee_id', employee.id).maybeSingle();
  if (existing) {
    throw new HTTPException(409, { message: 'Este colaborador ya tiene foto de registro. Un administrador debe borrarla antes de tomar otra.' });
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
  const { error } = await db.from('faces').insert({
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
      message: error.code === '23505' ? 'Este colaborador ya tiene foto de registro.' : 'No se pudo guardar la foto. Intenta de nuevo.',
    });
  }
  // Fecha visible para supervisores sin exponer la biometría
  await db
    .from('employee_settings')
    .upsert({ employee_id: employee.id, company_id: employee.company_id, face_enrolled_at: now }, { onConflict: 'employee_id' });
  await audit(c.env, {
    company_id: employee.company_id,
    actor_id: auth.userId,
    action: 'jornada.face.enrolled_in_person',
    entity: 'jornada.faces',
    entity_id: employee.id,
  });
  return c.json({ ok: true, enrolled_at: now }, 201);
});
