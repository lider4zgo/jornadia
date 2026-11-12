import { useEffect, useState } from 'react';
import { buildShifts, formatMinutes, localDate, PUNCH_LABELS, summarizeWeeks, weekStart } from '@korporia/jornada';
import { api, ApiError } from '../../../lib/api';
import { formatDate, formatTime, serverNow } from '../../../lib/clock';
import type { Me } from '../../../types';
import { punchTime, weeklyLimit, type PunchRow } from '../types';

/** Historial del trabajador y avance de su semana contra el tope de la LFT. */
export function History({ me }: { me: Me }) {
  const tz = me.company?.timezone ?? 'America/Mexico_City';
  const [rows, setRows] = useState<PunchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me.employee) return;
    const since = new Date(serverNow().getTime() - 21 * 86_400_000).toISOString();
    api<{ punches: PunchRow[] }>(`/api/jornada/punches?employee_id=${me.employee.id}&from=${since}&limit=300`)
      .then((r) => setRows(r.punches))
      .catch(() => setError('No se pudo cargar tu historial. Revisa tu conexión.'));
  }, [me.employee]);

  if (error) return <div className="content"><div className="notice error">{error}</div></div>;
  if (!rows) return <div className="content"><p className="muted">Cargando…</p></div>;

  const today = localDate(serverNow(), tz);
  const thisWeek = weekStart(today);
  const weeks = summarizeWeeks(buildShifts(rows.map((r) => ({ kind: r.kind, ts: punchTime(r) })), tz), {
    limitHours: weeklyLimit(me.jornada),
  });
  const current = weeks.find((w) => w.weekStart === thisWeek);
  const limit = weeklyLimit(me.jornada);
  const worked = current?.workedMinutes ?? 0;
  const pct = Math.min(100, (worked / (limit * 60)) * 100);

  const byDay = new Map<string, PunchRow[]>();
  for (const r of rows) {
    const d = localDate(punchTime(r), tz);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }

  return (
    <div className="content">
      <Export me={me} today={today} />
      <section className="sheet" aria-labelledby="week-title">
        <h2 id="week-title">Esta semana</h2>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700, lineHeight: 1 }}>
          {formatMinutes(worked)} <span className="muted" style={{ fontSize: '1.1rem', fontWeight: 500 }}>de {limit} h</span>
        </p>
        <div
          className={`meter ${worked > limit * 60 ? 'over' : current?.nearLimit ? 'near' : ''}`}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={limit * 60}
          aria-valuenow={worked}
          aria-label="Horas trabajadas en la semana"
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        {current && current.overtimeMinutes > 0 && <p className="muted">Horas extra: {formatMinutes(current.overtimeMinutes)}</p>}
        {current && current.incompleteShifts > 0 && (
          <p className="muted">Tienes {current.incompleteShifts} día(s) sin salida registrada; no cuentan hasta que tu supervisor los corrija.</p>
        )}
      </section>

      {rows.length === 0 ? (
        <p className="muted">Todavía no tienes checadas en las últimas tres semanas.</p>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <section key={day} className="stack" style={{ gap: 6 }}>
            <h3 className="day-head">{day === today ? 'Hoy' : formatDate(`${day}T18:00:00Z`, tz)}</h3>
            <div className="list">
              {list.map((p) => (
                <div className="row" key={p.id}>
                  <span className="time">{formatTime(punchTime(p), tz)}</span>
                  <div className="grow">
                    <div>{PUNCH_LABELS[p.kind]}</div>
                    <div className="sub">{p.sites?.name ?? 'Sin obra'}{p.captured_offline ? ', enviada sin conexión' : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/** Descarga "Mis registros" (CSV) de un periodo, aunque el checador del plan ya haya terminado. */
function Export({ me, today }: { me: Me; today: string }) {
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<Response>(`/api/jornada/punches/mine.csv?from=${from}&to=${to}`, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `mis-registros-${from}-a-${to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo descargar. Revisa tu conexión.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="sheet">
      <summary>Descargar mis registros</summary>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label className="field">
          Desde
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          Hasta
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {error && <div className="notice error">{error}</div>}
      <button className="btn block" disabled={busy || !from || !to} onClick={() => void download()}>
        {busy ? 'Preparando…' : 'Descargar (Excel / CSV)'}
      </button>
      <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>{me.company?.name}: incluye las correcciones hechas por tu supervisor.</p>
    </details>
  );
}
