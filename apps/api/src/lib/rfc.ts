import type { Env } from '../env';
import { adminClient, coreDb } from './supabase';

/** T-08: una cuenta de Korporia por RFC (Dirección, 12 nov 2026). */
export const RFC_TAKEN =
  'Ya hay una cuenta de Korporia con este RFC. Si es de tu empresa, pide acceso a su administrador o escríbenos a soporte@korporia.com.';

/** ¿Otra empresa (no archivada) ya usa este RFC? */
export async function rfcInUse(env: Env, rfc: string, exceptCompanyId?: string): Promise<boolean> {
  const core = coreDb(adminClient(env));
  const { data } = await core.from('companies').select('id').ilike('tax_id', rfc).limit(5);
  const others = (data ?? []).map((r) => r.id as string).filter((id) => id !== exceptCompanyId);
  if (!others.length) return false;
  const { data: subs } = await core.from('subscriptions').select('company_id, status').in('company_id', others);
  return (subs ?? []).some((s) => s.status !== 'archived') || others.some((id) => !(subs ?? []).some((s) => s.company_id === id));
}
