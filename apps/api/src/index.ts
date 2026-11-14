import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { CodedError } from './lib/errors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { companies } from './core/companies';
import { employees } from './core/employees';
import { me } from './core/me';
import { importer } from './core/import';
import { members } from './core/members';
import { my } from './core/my';
import { signup, waitlist } from './core/signup';
import { referrals } from './core/referrals';
import { account, device } from './core/device';
import { profile } from './core/profile';
import { activation, workerAccess } from './core/worker-access';
import { runDailyJobs } from './lib/daily';
import { serveStatic } from './lib/static';
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
app.route('/api/core/employees', activation);
app.route('/api/core/import', importer);
app.route('/api/core/my', my);
app.route('/api/core/worker-access', workerAccess);
app.route('/api/core/signup', signup);
app.route('/api/core/waitlist', waitlist);
app.route('/api/core/referrals', referrals);
app.route('/api/core/device', device);
app.route('/api/core/account', account);
app.route('/api/core/profile', profile);

// Módulos: cada uno en /api/<módulo>
for (const module of MODULE_REGISTRY) app.route(`/api/${module.key}`, module.routes);

// Todo lo que no es /api: el sitio (korporia.com) o la app (app.korporia.com), según el dominio
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Ruta no encontrada.' }, 404);
  return serveStatic(c.req.raw, c.env.ASSETS);
});

app.onError((err, c) => {
  if (err instanceof CodedError) return c.json({ error: err.message, code: err.code }, err.status);
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' }, 500);
});

export default {
  fetch: app.fetch,
  /** Cron diario (wrangler.toml → [triggers]): vigencias de planes y borrado de selfies. */
  async scheduled(_event: ScheduledController, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(runDailyJobs(env).then((r) => console.log('daily jobs', JSON.stringify(r))));
  },
} satisfies ExportedHandler<AppEnv['Bindings']>;
