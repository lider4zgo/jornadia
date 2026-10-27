export interface Env {
  ASSETS: Fetcher;
  FILES: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_EMAIL_DOMAIN: string;
}

export type Role = 'owner' | 'admin' | 'supervisor' | 'worker';

export interface Membership {
  id: string;
  company_id: string;
  role: Role;
}

export interface AuthContext {
  userId: string;
  accessToken: string;
  memberships: Membership[];
  isPlatformAdmin: boolean;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};
