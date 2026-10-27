import type { PunchKind, Site } from '@jornadia/core';

export type Role = 'owner' | 'admin' | 'supervisor' | 'worker';

export interface Company {
  id: string;
  name: string;
  code: string;
  status: string;
  plan: string;
  employee_limit: number;
  trial_ends_at: string | null;
  timezone: string;
  weekly_hour_limit: number;
  face_match_threshold: number;
  whatsapp_support: string | null;
}

export interface Me {
  userId: string;
  isPlatformAdmin: boolean;
  role?: Role;
  company?: Company;
  companies: { id: string; name: string }[];
  sites?: (Site & { address?: string | null })[];
  employee?: {
    id: string;
    employee_number: string;
    full_name: string;
    position: string | null;
    default_site_id: string | null;
    consent_confirmed_at: string | null;
    active: boolean;
  } | null;
  lastPunch?: { id: string; kind: PunchKind; server_ts: string; site_id: string | null } | null;
  nextKinds?: PunchKind[];
  face?: { descriptor: number[]; model_version: string; enrolled_at: string; approved_at: string | null } | null;
  serverTime: string;
}

export interface PunchRow {
  id: string;
  employee_id: string;
  site_id: string | null;
  kind: PunchKind;
  server_ts: string;
  device_ts: string | null;
  captured_offline: boolean;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  inside_geofence: boolean | null;
  face_score: number | null;
  face_matched: boolean | null;
  liveness_passed: boolean | null;
  selfie_path: string | null;
  flags: string[];
  seq: number;
  employees?: { full_name: string; employee_number: string } | null;
  sites?: { name: string } | null;
}

export const FLAG_LABELS: Record<string, string> = {
  outside_geofence: 'Fuera de la obra',
  gps_low_accuracy: 'GPS impreciso',
  no_location: 'Sin ubicación',
  no_sites_configured: 'Sin obras configuradas',
  impossible_jump: 'Ubicación sospechosa',
  face_mismatch: 'Rostro no coincide',
  face_not_checked: 'Rostro sin verificar',
  no_face_reference: 'Sin foto de registro',
  liveness_failed: 'Prueba de vida fallida',
  captured_offline: 'Sin conexión',
  late_sync: 'Enviada con retraso',
  device_clock_ahead: 'Reloj del teléfono adelantado',
  out_of_sequence: 'Fuera de secuencia',
  consent_missing: 'Falta consentimiento',
};

/** Hora efectiva: una checada sin conexión cuenta a la hora en que ocurrió en el teléfono. */
export function punchTime(p: Pick<PunchRow, 'server_ts' | 'device_ts' | 'captured_offline'>): string {
  if (p.captured_offline && p.device_ts && p.device_ts <= p.server_ts) return p.device_ts;
  return p.server_ts;
}
