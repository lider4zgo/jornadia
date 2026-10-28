import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { me } from './routes/me';
import { punches } from './routes/punches';
import { reports } from './routes/reports';
import { files } from './routes/files';
import { adminRoutes } from './routes/admin';
import { workerAuth } from './routes/worker-auth';

const app = new Hono<AppEnv>();

app.use('/api/*', secureHeaders());
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
});

app.get('/api/health', (c) => c.json({ ok: true, serverTime: new Date().toISOString() }));
app.route('/api/auth/worker', workerAuth);
app.route('/api/me', me);
app.route('/api/punches', punches);
app.route('/api/reports', reports);
app.route('/api/files', files);
app.route('/api/admin', adminRoutes);

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
