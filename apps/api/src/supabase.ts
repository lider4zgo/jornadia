import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';

const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Cliente con privilegios de servicio: solo para escrituras ya validadas por la API. */
export function adminClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
}

/** Cliente que actúa como el usuario: todas las lecturas pasan por RLS. */
export function userClient(env: Env, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...options,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export { workerEmail } from '@jornadia/core';
