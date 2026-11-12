import type { Site } from '@korporia/jornada';
import type { JornadaMe } from './modules/jornada/types';

export interface Subscription {
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'archived';
  plan: string;
  employee_limit: number;
  trial_ends_at: string | null;
  /** Usuarios de administración permitidos (Korporia Starter: 1) */
  admin_limit: number | null;
  /** Korporia Starter: fin del checador (día 90) y de RH básico (mes 6) */
  starter_clock_until: string | null;
  starter_hr_until: string | null;
  /** Desde aquí la cuenta queda en solo lectura (90 días con exportación) */
  read_only_at: string | null;
  doc_mb_per_employee: number | null;
}

export type WorkerDocKey = 'aviso_trabajadores' | 'acuerdo_jornada' | 'biometria';

/** Estado del trabajador: PIN y documentos por firmar. */
export interface WorkerState {
  hasPin: boolean;
  pending: WorkerDocKey[];
  biometric: 'autorizo' | 'no_autorizo' | 'retiro' | null;
}

export interface Company {
  id: string;
  name: string;
  code: string;
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  whatsapp_support: string | null;
  subscription: Subscription | null;
}

export interface SelfEmployee {
  id: string;
  employee_number: string;
  full_name: string;
  position: string | null;
  default_site_id: string | null;
  active: boolean;
}

/** Respuesta de /api/core/me: todo lo que la app necesita al abrir. */
export interface Me {
  userId: string;
  isPlatformAdmin: boolean;
  role?: string;
  /** Permisos efectivos en la empresa activa (ya descontados los módulos no contratados) */
  permissions: string[];
  /** Módulos activos de la empresa */
  modules: string[];
  /** Módulos que aceptan cambios hoy ('core' = la cuenta); los demás, solo lectura por el plan */
  writable?: string[];
  worker?: WorkerState | null;
  rh?: { pendingLeaves: number };
  company?: Company;
  companies: { id: string; name: string }[];
  sites?: (Site & { address?: string | null })[];
  employee?: SelfEmployee | null;
  /** Datos del módulo Jornada, si la empresa lo tiene */
  jornada?: JornadaMe;
  serverTime: string;
}
