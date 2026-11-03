import type { Site } from '@korporia/jornada';
import type { JornadaMe } from './modules/jornada/types';

export interface Subscription {
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'archived';
  plan: string;
  employee_limit: number;
  trial_ends_at: string | null;
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
  company?: Company;
  companies: { id: string; name: string }[];
  sites?: (Site & { address?: string | null })[];
  employee?: SelfEmployee | null;
  /** Datos del módulo Jornada, si la empresa lo tiene */
  jornada?: JornadaMe;
  serverTime: string;
}
