import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { requireAuth } from '../auth';
import { userClient } from '../supabase';

export const files = new Hono<AppEnv>();
files.use('*', requireAuth);

/**
 * Entrega una selfie o foto de referencia solo si el usuario puede ver el
 * registro al que pertenece (la verificación la hace RLS en Supabase).
 *   GET /api/files?path=selfies/…
 */
files.get('/', async (c) => {
  const auth = c.get('auth');
  const path = c.req.query('path') ?? '';
  if (!/^(selfies|faces)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[\w./-]+$/.test(path) || path.includes('..')) {
    throw new HTTPException(400, { message: 'Ruta inválida.' });
  }

  // Solo supervisores y administradores ven fotos (un trabajador no puede ver las de nadie)
  const company = path.split('/')[1];
  const role = auth.memberships.find((m) => m.company_id === company)?.role;
  if (!auth.isPlatformAdmin && (!role || role === 'worker')) throw new HTTPException(403, { message: 'No tienes permiso para ver esta foto.' });

  const db = userClient(c.env, auth.accessToken);
  const allowed = path.startsWith('selfies/')
    ? await db.from('punches').select('id').eq('selfie_path', path).limit(1).maybeSingle()
    : await db.from('employee_faces').select('employee_id').eq('photo_path', path).limit(1).maybeSingle();
  if (!allowed.data) throw new HTTPException(404, { message: 'Archivo no encontrado.' });

  const object = await c.env.FILES.get(path);
  if (!object) throw new HTTPException(404, { message: 'Archivo no encontrado.' });

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
