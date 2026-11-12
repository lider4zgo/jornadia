export interface Env {
  ASSETS: Fetcher;
  FILES: R2Bucket;
  SUPABASE_URL: string;
  /** Llave pública (sb_publishable_…): actúa como el usuario, sujeta a RLS */
  SUPABASE_PUBLISHABLE_KEY: string;
  /** Llave secreta (sb_secret_…): privilegios de servicio, solo en el servidor */
  SUPABASE_SECRET_KEY: string;
  WORKER_EMAIL_DOMAIN: string;
}

export type CompanyStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'archived';

/** Acceso del usuario a una empresa: rol, permisos y módulos contratados. */
export interface CompanyAccess {
  membershipId: string;
  companyId: string;
  role: string;
  permissions: Set<string>;
  modules: Set<string>;
  /** Módulos que hoy aceptan cambios ('core' = la cuenta); los demás están en solo lectura por el plan */
  writable: Set<string>;
  status: CompanyStatus | null;
}

export interface AuthContext {
  userId: string;
  accessToken: string;
  access: CompanyAccess[];
  isPlatformAdmin: boolean;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};
