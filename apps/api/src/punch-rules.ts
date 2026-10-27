import {
  evaluateGeofence,
  isImpossibleJump,
  transitionError,
  type GeofenceResult,
  type PunchKind,
  type Site,
} from '@jornadia/core';

export interface PunchInput {
  client_uuid: string;
  kind: PunchKind;
  site_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracy_m?: number | null;
  device_ts?: string | null;
  captured_offline?: boolean;
  face_score?: number | null;
  liveness_passed?: boolean | null;
  antispoof_score?: number | null;
  model_version?: string | null;
  device_info?: Record<string, unknown>;
}

export interface PunchContext {
  sites: Site[];
  lastPunch: { kind: PunchKind; server_ts: string; lat: number | null; lng: number | null } | null;
  faceThreshold: number;
  hasFaceReference: boolean;
  consentConfirmed: boolean;
  now: Date;
}

export type PunchDecision =
  | { ok: true; flags: string[]; geofence: GeofenceResult; faceMatched: boolean | null }
  | { ok: false; status: 400 | 409 | 422; message: string; code: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS: PunchKind[] = ['in', 'break_start', 'break_end', 'out'];

/** Valida forma y rangos de los datos recibidos del teléfono. */
export function parsePunchInput(raw: unknown): PunchInput | string {
  if (!raw || typeof raw !== 'object') return 'Datos de checada inválidos.';
  const r = raw as Record<string, unknown>;
  if (typeof r.client_uuid !== 'string' || !UUID_RE.test(r.client_uuid)) return 'Identificador de checada inválido.';
  if (!KINDS.includes(r.kind as PunchKind)) return 'Tipo de checada inválido.';
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const lat = num(r.lat);
  const lng = num(r.lng);
  if ((lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) return 'Coordenadas inválidas.';
  const faceScore = num(r.face_score);
  if (faceScore !== null && (faceScore < 0 || faceScore > 1)) return 'Puntaje facial inválido.';
  let deviceTs: string | null = null;
  if (typeof r.device_ts === 'string' && !Number.isNaN(Date.parse(r.device_ts))) deviceTs = new Date(r.device_ts).toISOString();
  return {
    client_uuid: r.client_uuid.toLowerCase(),
    kind: r.kind as PunchKind,
    site_id: typeof r.site_id === 'string' && UUID_RE.test(r.site_id) ? r.site_id : null,
    lat,
    lng,
    accuracy_m: num(r.accuracy_m),
    device_ts: deviceTs,
    captured_offline: r.captured_offline === true,
    face_score: faceScore,
    liveness_passed: typeof r.liveness_passed === 'boolean' ? r.liveness_passed : null,
    antispoof_score: num(r.antispoof_score),
    model_version: typeof r.model_version === 'string' ? r.model_version.slice(0, 64) : null,
    device_info: r.device_info && typeof r.device_info === 'object' ? (r.device_info as Record<string, unknown>) : {},
  };
}

/**
 * Decide si se acepta una checada y con qué banderas.
 *
 * Regla general: una checada en línea que no cumple (fuera de geocerca en modo
 * "bloquear", rostro que no coincide, secuencia inválida) se rechaza para que el
 * trabajador lo corrija en el momento. Una checada capturada SIN conexión ya
 * ocurrió y no se puede repetir, así que se acepta siempre y se marca para revisión.
 */
export function decidePunch(input: PunchInput, ctx: PunchContext): PunchDecision {
  const offline = input.captured_offline === true;
  const flags: string[] = [];

  // Secuencia
  const seqError = transitionError(ctx.lastPunch?.kind ?? null, input.kind);
  if (seqError) {
    if (!offline) return { ok: false, status: 409, code: 'sequence', message: seqError };
    flags.push('out_of_sequence');
  }

  // Ubicación y geocerca
  const point = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng, accuracy_m: input.accuracy_m } : null;
  const geofence = evaluateGeofence(point, ctx.sites, input.site_id);
  flags.push(...geofence.flags);
  if (geofence.blocked && !offline) {
    const where = geofence.site ? `de ${geofence.site.name}` : 'de una obra autorizada';
    const dist = geofence.distance_m != null ? ` (estás a ${geofence.distance_m} m)` : '';
    return {
      ok: false,
      status: 422,
      code: 'geofence',
      message: point ? `Debes estar dentro ${where} para checar${dist}.` : 'Activa la ubicación de tu teléfono para checar.',
    };
  }

  // Salto imposible respecto a la checada anterior
  if (point && ctx.lastPunch?.lat != null && ctx.lastPunch.lng != null) {
    const prev = { lat: ctx.lastPunch.lat, lng: ctx.lastPunch.lng, ts: ctx.lastPunch.server_ts };
    const nextTs = offline && input.device_ts ? input.device_ts : ctx.now.toISOString();
    if (isImpossibleJump(prev, { ...point, ts: nextTs })) flags.push('impossible_jump');
  }

  // Verificación facial (calculada en el teléfono; se guarda el puntaje para auditoría)
  let faceMatched: boolean | null = null;
  if (!ctx.hasFaceReference) {
    flags.push('no_face_reference');
  } else if (input.face_score == null) {
    if (!offline) return { ok: false, status: 422, code: 'face', message: 'No se pudo verificar tu rostro. Intenta de nuevo.' };
    flags.push('face_not_checked');
  } else {
    faceMatched = input.face_score >= ctx.faceThreshold;
    if (!faceMatched) {
      if (!offline) {
        return { ok: false, status: 422, code: 'face', message: 'Tu rostro no coincide con tu foto registrada. Intenta con mejor luz.' };
      }
      flags.push('face_mismatch');
    }
  }
  if (input.liveness_passed === false) {
    if (!offline) return { ok: false, status: 422, code: 'liveness', message: 'No se detectó una persona real frente a la cámara.' };
    flags.push('liveness_failed');
  }

  // Captura sin conexión
  if (offline) {
    flags.push('captured_offline');
    if (input.device_ts) {
      const lagHours = (ctx.now.getTime() - Date.parse(input.device_ts)) / 3_600_000;
      if (lagHours > 24) flags.push('late_sync');
      if (lagHours < -0.1) flags.push('device_clock_ahead');
    }
  }

  if (!ctx.consentConfirmed) flags.push('consent_missing');

  return { ok: true, flags: [...new Set(flags)], geofence, faceMatched };
}
