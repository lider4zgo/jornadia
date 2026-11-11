export type PunchKind = 'in' | 'break_start' | 'break_end' | 'out';

export type GeofenceMode = 'block' | 'flag';

export interface Site {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  geofence_mode: GeofenceMode;
  active?: boolean;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Precisión reportada por el navegador, en metros */
  accuracy_m?: number | null;
}

/** Checada mínima para calcular jornada */
export interface PunchLike {
  kind: PunchKind;
  /** ISO 8601 o Date */
  ts: string | Date;
}

export const PUNCH_LABELS: Record<PunchKind, string> = {
  in: 'Entrada',
  break_start: 'Inicio de comida',
  break_end: 'Fin de comida',
  out: 'Salida',
};
