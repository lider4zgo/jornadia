import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { companies } from './core/companies';
import { me } from './core/me';
import { members } from './core/members';
import { MODULE_REGISTRY } from './modules';

const app = new Hono<AppEnv>();

app.use('/api/*', secureHeaders());
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
});

app.get('/api/health', (c) => c.json({ ok: true, serverTime: new Date().toISOString() }));

// Núcleo: sesión, empresas, usuarios
app.route('/api/core/me', me);
app.route('/api/core/companies', companies);
app.route('/api/core/members', members);

// Módulos: cada uno en /api/<módulo>
for (const module of MODULE_REGISTRY) app.route(`/api/${module.key}`, module.routes);

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Ruta no encontrada.' }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' }, 500);
});

export default app;
