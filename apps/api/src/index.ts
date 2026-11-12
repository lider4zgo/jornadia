import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { companies } from './core/companies';
import { employees } from './core/employees';
import { me } from './core/me';
import { members } from './core/members';
import { MODULE_REGISTRY } from './modules';

const app = new Hono<AppEnv>();

app.use('/api/*', secureHeaders());
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
});

// Variables que el Worker necesita (solo se informa si existen, nunca su valor)
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'WORKER_EMAIL_DOMAIN'] as const;
const missingEnv = (env: Record<string, unknown>) => REQUIRED_ENV.filter((k) => typeof env[k] !== 'string' || !(env[k] as string).trim());

app.get('/api/health', (c) => {
  const missing = missingEnv(c.env as unknown as Record<string, unknown>);
  return c.json({ ok: missing.length === 0, missing, files: Boolean(c.env.FILES), serverTime: new Date().toISOString() }, missing.length ? 500 : 200);
});

app.use('/api/*', async (c, next) => {
  const missing = missingEnv(c.env as unknown as Record<string, unknown>);
  if (missing.length) {
    console.error('Missing Worker configuration', missing);
    return c.json({ error: `Falta configurar en el Worker: ${missing.join(', ')}.` }, 500);
  }
  await next();
});

// Núcleo: sesión, empresas, usuarios
app.route('/api/core/me', me);
app.route('/api/core/companies', companies);
app.route('/api/core/members', members);
app.route('/api/core/employees', employees);

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
