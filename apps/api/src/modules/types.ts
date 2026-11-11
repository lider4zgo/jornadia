import type { Hono } from 'hono';
import type { ModuleKey } from '@korporia/core';
import type { AppEnv, AuthContext, Env } from '../env';

/** Colaborador del usuario en la empresa activa (de core.employees). */
export interface SelfEmployee {
  id: string;
  employee_number: string;
  full_name: string;
  position: string | null;
  default_site_id: string | null;
  active: boolean;
}

export interface ModuleContext {
  env: Env;
  auth: AuthContext;
  companyId: string;
  employee: SelfEmployee | null;
}

/** Datos del alta de un colaborador que cada módulo puede usar (p. ej., consentimiento biométrico). */
export interface EmployeeCreatedInput {
  actorId: string;
  employeeId: string;
  companyId: string;
  body: Record<string, unknown>;
}

/**
 * Contrato de un módulo de Korporia en la API.
 * Cada módulo se monta en /api/<key> y solo se activa para empresas que lo contrataron.
 */
export interface ApiModule {
  key: Exclude<ModuleKey, 'core'>;
  routes: Hono<AppEnv>;
  /** Lo que la app necesita al abrir, si la empresa tiene el módulo (va en /api/core/me bajo `key`). */
  me?: (ctx: ModuleContext) => Promise<unknown>;
  /** Se llama al dar de alta un colaborador en una empresa que tiene el módulo. */
  onEmployeeCreated?: (env: Env, input: EmployeeCreatedInput) => Promise<void>;
}
