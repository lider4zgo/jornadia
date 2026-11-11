import type { GeoPoint, Site } from './types';

const EARTH_RADIUS_M = 6_371_008.8;

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Precisión de GPS a partir de la cual el registro se marca para revisión. */
export const LOW_ACCURACY_M = 100;
/** Tolerancia máxima que se concede por imprecisión del GPS al evaluar la geocerca. */
export const MAX_ACCURACY_ALLOWANCE_M = 50;

export interface GeofenceResult {
  /** Obra más cercana (o la solicitada) */
  site: Site | null;
  distance_m: number | null;
  inside: boolean;
  /** true cuando la obra exige estar dentro y el punto está fuera */
  blocked: boolean;
  flags: string[];
}

/**
 * Evalúa la geocerca. Si se indica `preferredSiteId`, se evalúa contra esa obra;
 * de lo contrario, contra la obra activa más cercana.
 */
export function evaluateGeofence(point: GeoPoint | null, sites: Site[], preferredSiteId?: string | null): GeofenceResult {
  const active = sites.filter((s) => s.active !== false);
  if (!point) {
    const anyBlocking = active.some((s) => s.geofence_mode === 'block');
    return { site: null, distance_m: null, inside: false, blocked: anyBlocking, flags: ['no_location'] };
  }
  if (active.length === 0) {
    return { site: null, distance_m: null, inside: false, blocked: false, flags: ['no_sites_configured'] };
  }

  const candidates = preferredSiteId ? active.filter((s) => s.id === preferredSiteId) : active;
  const pool = candidates.length ? candidates : active;

  let best: { site: Site; d: number } | null = null;
  for (const site of pool) {
    const d = distanceMeters(point, site);
    if (!best || d - site.radius_m < best.d - best.site.radius_m) best = { site, d };
  }
  // `pool` nunca está vacío aquí
  const { site, d } = best!;

  const accuracy = point.accuracy_m ?? null;
  const allowance = accuracy == null ? 0 : Math.min(Math.max(accuracy, 0), MAX_ACCURACY_ALLOWANCE_M);
  const inside = d <= site.radius_m + allowance;

  const flags: string[] = [];
  if (accuracy != null && accuracy > LOW_ACCURACY_M) flags.push('gps_low_accuracy');
  if (!inside) flags.push('outside_geofence');

  return {
    site,
    distance_m: Math.round(d),
    inside,
    blocked: !inside && site.geofence_mode === 'block',
    flags,
  };
}

/**
 * Detecta saltos físicamente imposibles entre dos checadas consecutivas
 * (posible GPS falso). Velocidad por defecto: 200 km/h.
 */
export function isImpossibleJump(
  prev: { lat: number; lng: number; ts: string | Date },
  next: { lat: number; lng: number; ts: string | Date },
  maxSpeedKmh = 200,
): boolean {
  const seconds = (new Date(next.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
  if (seconds <= 0) return false;
  const km = distanceMeters(prev, next) / 1000;
  // Saltos menores a 2 km no se consideran (ruido normal del GPS)
  if (km < 2) return false;
  return km / (seconds / 3600) > maxSpeedKmh;
}
