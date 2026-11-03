export interface Env {
  ASSETS: Fetcher;
  FILES: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
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
