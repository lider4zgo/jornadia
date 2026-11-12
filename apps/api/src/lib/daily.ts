import { LEGAL_VERSIONS } from '@korporia/core';
import type { Env } from '../env';
import { adminClient, audit, coreDb, jornadaDb } from './supabase';

/** Borra todos los objetos de R2 bajo un prefijo. */
async function deletePrefix(env: Env, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) await env.FILES.delete(keys);
    deleted += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

/**
 * Tareas diarias (cron del Worker):
 *  1. Archiva cuentas 90 días después de pasar a solo lectura e inscribe a la lista de
 *     espera de Despegue a los dueños de Korporia Starter que llegaron al día 90.
 *  2. Borra selfies y foto de registro 1 año después de la baja del colaborador (Legal).
 *     Las checadas se conservan; solo pierden la imagen.
 */
export async function runDailyJobs(env: Env): Promise<Record<string, unknown>> {
  const admin = adminClient(env);
  const core = coreDb(admin);
  const result: Record<string, unknown> = {};

  const { data: jobs, error } = await core.rpc('run_daily_jobs', { p_consent_version: LEGAL_VERSIONS.listaEspera });
  if (error) console.error('run_daily_jobs failed', error);
  result.accounts = jobs;

  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: due }, { data: done }] = await Promise.all([
    core.from('employees').select('id, company_id').eq('active', false).lte('terminated_at', cutoff).limit(200),
    jornadaDb(admin).from('selfie_purges').select('employee_id'),
  ]);
  const purged = new Set((done ?? []).map((d) => d.employee_id));
  let employees = 0;
  for (const e of (due ?? []).filter((x) => !purged.has(x.id))) {
    const objects =
      (await deletePrefix(env, `selfies/${e.company_id}/${e.id}/`)) + (await deletePrefix(env, `faces/${e.company_id}/${e.id}/`));
    await jornadaDb(admin).from('faces').delete().eq('employee_id', e.id);
    await jornadaDb(admin).from('selfie_purges').insert({ employee_id: e.id, company_id: e.company_id, objects });
    await audit(env, { company_id: e.company_id, actor_id: null, action: 'jornada.selfies_purged', entity: 'core.employees', entity_id: e.id, details: { objects } });
    employees++;
  }
  result.selfiePurges = employees;
  return result;
}
