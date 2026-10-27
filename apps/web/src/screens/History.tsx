import { useEffect, useState } from 'react';
import { buildShifts, formatMinutes, localDate, PUNCH_LABELS, summarizeWeeks, weekStart } from '@jornadia/core';
import { api } from '../lib/api';
import { formatDate, formatTime, serverNow } from '../lib/clock';
import { punchTime, type Me, type PunchRow } from '../types';

/** Historial del trabajador y avance de su semana contra el tope de la LFT. */
export function History({ me }: { me: Me }) {
  const tz = me.company?.timezone ?? 'America/Mexico_City';
  const [rows, setRows] = useState<PunchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me.employee) return;
    const since = new Date(serverNow().getTime() - 21 * 86_400_000).toISOString();
    api<{ punches: PunchRow[] }>(`/api/punches?employee_id=${me.employee.id}&from=${since}&limit=300`)
      .then((r) => setRows(r.punches))
      .catch(() => setError('No se pudo cargar tu historial. Revisa tu conexión.'));
  }, [me.employee]);

  if (error) return <div className="content"><div className="notice error">{error}</div></div>;
  if (!rows) return <div className="content"><p className="muted">Cargando…</p></div>;

  const today = localDate(serverNow(), tz);
  const thisWeek = weekStart(today);
  const weeks = summarizeWeeks(buildShifts(rows.map((r) => ({ kind: r.kind, ts: punchTime(r) })), tz), {
    limitHours: me.company?.weekly_hour_limit,
  });
  const current = weeks.find((w) => w.weekStart === thisWeek);
  const limit = me.company?.weekly_hour_limit ?? 46;
  const worked = current?.workedMinutes ?? 0;
  const pct = Math.min(100, (worked / (limit * 60)) * 100);

  const byDay = new Map<string, PunchRow[]>();
  for (const r of rows) {
    const d = localDate(punchTime(r), tz);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }

  return (
    <div className="content">
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
