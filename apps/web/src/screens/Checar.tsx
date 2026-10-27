import { useEffect, useMemo, useState } from 'react';
import { allowedNextKinds, PUNCH_LABELS, type PunchKind } from '@jornadia/core';
import { api, ApiError, NetworkError } from '../lib/api';
import { formatDate, formatTime, serverNow } from '../lib/clock';
import { faceModelVersion, type CheckResult } from '../lib/face';
import { getPosition, LocationError, type Position } from '../lib/geo';
import { toCompressedJpeg } from '../lib/image';
import { dismiss, enqueue, onQueueChange, punchForm, type QueuedPunch } from '../lib/queue';
import { useOnline, useServerNow } from '../common';
import { Capture } from './Capture';
import type { Me } from '../types';

const ACTION_LABEL: Record<PunchKind, string> = {
  in: 'Registrar entrada',
  out: 'Registrar salida',
  break_start: 'Iniciar comida',
  break_end: 'Terminar comida',
};
const PRIORITY: PunchKind[] = ['out', 'break_end', 'in', 'break_start'];

type Outcome =
  | { type: 'ok'; kind: PunchKind; at: string; site: string | null; flags: string[] }
  | { type: 'queued'; kind: PunchKind; at: string }
  | { type: 'error'; kind: PunchKind; message: string };

export function Checar({ me, onPunched }: { me: Me; onPunched: () => void }) {
  const tz = me.company?.timezone ?? 'America/Mexico_City';
  const now = useServerNow();
  const online = useOnline();
  const [queue, setQueue] = useState<QueuedPunch[]>([]);
  const [capturing, setCapturing] = useState<PunchKind | null>(null);
  const [positionPromise, setPositionPromise] = useState<Promise<Position | null> | null>(null);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => onQueueChange(setQueue), []);

  const pending = queue.filter((q) => !q.rejected && q.companyId === me.company?.id);
  const rejected = queue.filter((q) => q.rejected && q.companyId === me.company?.id);

  // La última checada puede estar todavía en la cola del teléfono
  const last = useMemo(() => {
    const queued = pending.at(-1);
    if (queued) return { kind: queued.kind, at: queued.queuedAt, site: null as string | null };
    if (me.lastPunch) {
      const site = me.sites?.find((s) => s.id === me.lastPunch!.site_id)?.name ?? null;
      return { kind: me.lastPunch.kind, at: me.lastPunch.server_ts, site };
    }
    return null;
  }, [pending, me.lastPunch, me.sites]);

  const next = allowedNextKinds(last?.kind ?? null).sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
  const [primary, ...secondary] = next;

  function start(kind: PunchKind) {
    setOutcome(null);
    // La ubicación se pide en paralelo mientras el trabajador se toma la selfie
    setPositionPromise(
      getPosition().catch((err) => {
        if (err instanceof LocationError) console.warn(err.message);
        return null;
      }),
    );
    setCapturing(kind);
  }

  async function finish(kind: PunchKind, face: CheckResult) {
    setCapturing(null);
    setSending(true);
    try {
      const [position, selfie, modelVersion] = await Promise.all([
        positionPromise ?? Promise.resolve(null),
        toCompressedJpeg(face.frame),
        faceModelVersion(),
      ]);
      const deviceTs = serverNow().toISOString();
      const data = {
        client_uuid: crypto.randomUUID(),
        kind,
        site_id: me.employee?.default_site_id ?? null,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        accuracy_m: position?.accuracy_m ?? null,
        device_ts: deviceTs,
        face_score: face.similarity,
        liveness_passed: face.livenessPassed,
        antispoof_score: Math.round(face.real * 1000) / 1000,
        model_version: modelVersion,
        device_info: {
          live: Math.round(face.live * 1000) / 1000,
          blinked: face.blinked,
          screen: `${screen.width}x${screen.height}`,
          lang: navigator.language,
        },
      };

      const saveOffline = async () => {
        await enqueue({ client_uuid: data.client_uuid, companyId: me.company!.id, kind, data: { ...data, captured_offline: true }, selfie });
        setOutcome({ type: 'queued', kind, at: deviceTs });
      };

      if (!navigator.onLine) {
        await saveOffline();
        return;
      }
      try {
        const res = await api<{ punch: { server_ts: string; flags: string[] }; site: string | null }>('/api/punches', {
          body: punchForm({ ...data, captured_offline: false }, selfie),
          timeoutMs: 25000,
        });
        setOutcome({ type: 'ok', kind, at: res.punch.server_ts, site: res.site, flags: res.punch.flags });
        onPunched();
      } catch (err) {
        if (err instanceof NetworkError) await saveOffline();
        else throw err;
      }
    } catch (err) {
      setOutcome({ type: 'error', kind, message: err instanceof ApiError || err instanceof Error ? err.message : 'No se pudo registrar.' });
    } finally {
      setSending(false);
    }
  }

  if (outcome && outcome.type !== 'error') {
    return (
      <div className="content">
        <div className={`result ${outcome.type}`} role="status">
          <span className="badge" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              {outcome.type === 'ok' ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 7v6M12 17h.01" />}
            </svg>
          </span>
          <h1>{outcome.type === 'ok' ? `${PUNCH_LABELS[outcome.kind]} registrada` : `${PUNCH_LABELS[outcome.kind]} guardada en tu teléfono`}</h1>
          <p className="big">{formatTime(outcome.at, tz)}</p>
          {outcome.type === 'ok' ? (
            <p className="muted">{outcome.site ? `En ${outcome.site}.` : 'Ubicación registrada.'}</p>
          ) : (
            <p>
              No hay señal. Tu checada quedó guardada con su hora y ubicación, y se enviará sola cuando el teléfono recupere conexión.
              No cierres sesión.
            </p>
          )}
          {outcome.type === 'ok' && outcome.flags.includes('outside_geofence') && (
            <div className="notice warn">Quedó registrada fuera del área de la obra; tu supervisor la revisará.</div>
          )}
        </div>
        <div className="actions">
          <button className="btn block" onClick={() => setOutcome(null)}>
            Listo
          </button>
        </div>
      </div>
    );
  }

  const statusText = !last
    ? 'Aún no tienes checadas.'
    : last.kind === 'in' || last.kind === 'break_end'
      ? `Trabajando desde las ${formatTime(last.at, tz)}${last.site ? ` en ${last.site}` : ''}.`
      : last.kind === 'break_start'
        ? `En comida desde las ${formatTime(last.at, tz)}.`
        : `Fuera de turno. Última salida a las ${formatTime(last.at, tz)}.`;
  const statusClass = last?.kind === 'in' || last?.kind === 'break_end' ? 'on' : last?.kind === 'break_start' ? 'break' : '';

  const [hh, mm, ss] = formatTime(now, tz, true).split(':');

  return (
    <div className="content">
      <div className="clock">
        <time dateTime={now.toISOString()} aria-label={`Son las ${hh}:${mm}`}>
          {hh}:{mm}
          <span className="sec">{ss}</span>
        </time>
        <p className="date">{formatDate(now, tz)}</p>
      </div>

      <p className={`status-line ${statusClass}`}>{statusText}</p>

      <div className="chips">
        <span className={`chip dot ${online ? 'go' : 'warn'}`}>{online ? 'En línea' : 'Sin señal: se guardará en el teléfono'}</span>
        {pending.length > 0 && (
          <span className="chip warn">
            {pending.length === 1 ? '1 checada por enviar' : `${pending.length} checadas por enviar`}
          </span>
        )}
      </div>

      {rejected.map((r) => (
        <div key={r.client_uuid} className="notice error" role="alert">
          <strong>
            {PUNCH_LABELS[r.kind]} de las {formatTime(String(r.data.device_ts ?? r.queuedAt), tz)} no se pudo registrar
          </strong>
          {r.rejected} Avisa a tu supervisor para que la corrija.
          <div style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => void dismiss(r.client_uuid)}>
              Entendido
            </button>
          </div>
        </div>
      ))}

      {outcome?.type === 'error' && (
        <div className="notice error" role="alert">
          <strong>No se registró tu {PUNCH_LABELS[outcome.kind].toLowerCase()}</strong>
          {outcome.message}
        </div>
      )}

      <div className="actions">
        {primary && (
          <button className="btn primary block" onClick={() => start(primary)} disabled={sending}>
            {sending ? 'Registrando…' : ACTION_LABEL[primary]}
          </button>
        )}
        {secondary.map((k) => (
          <button key={k} className="btn block" onClick={() => start(k)} disabled={sending}>
            {ACTION_LABEL[k]}
          </button>
        ))}
      </div>

      {capturing && (
        <Capture
          title={ACTION_LABEL[capturing]}
          reference={me.face?.descriptor ?? null}
          onDone={(r) => void finish(capturing, r)}
          onCancel={() => setCapturing(null)}
        />
      )}
    </div>
  );
}
