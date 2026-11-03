import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';

const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;

let cached: { key: string; client: SupabaseClient } | null = null;

/** Cliente con privilegios de servicio: solo para lecturas internas y escrituras ya validadas por la API. */
export function adminClient(env: Env): SupabaseClient {
  const key = `${env.SUPABASE_URL}|${env.SUPABASE_SERVICE_ROLE_KEY}`;
  if (cached?.key !== key) cached = { key, client: createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options) };
  return cached.client;
}

/** Cliente que actúa como el usuario: todas las lecturas pasan por RLS. */
export function userClient(env: Env, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...options,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Cada módulo vive en su propio esquema de PostgreSQL.
 * En Supabase deben estar en Project Settings → Data API → Exposed schemas.
 */
export const coreDb = (client: SupabaseClient) => client.schema('core');
export const jornadaDb = (client: SupabaseClient) => client.schema('jornada');

/** Registra una acción en la bitácora general. Nunca interrumpe la operación si falla. */
export async function audit(
  env: Env,
  entry: { company_id: string | null; actor_id: string | null; action: string; entity: string; entity_id?: string | null; details?: Record<string, unknown> },
) {
  const { error } = await coreDb(adminClient(env)).from('audit_log').insert(entry);
  if (error) console.error('audit_log insert failed', error);
}
