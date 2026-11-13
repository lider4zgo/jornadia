import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { can, writable } from '../../lib/access';
import type { Me } from '../../types';

interface CalendarData {
  year: number;
  official: { date: string; name: string }[];
  company: { day: string; kind: 'descanso' | 'festivo'; name: string }[];
}

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

/**
 * ORG-05: calendario laboral. Los días de descanso obligatorio de la ley se ven solos; la empresa
 * agrega los suyos. Ninguno cuenta como día de vacaciones y, si alguien trabaja, el reporte lo marca.
 */
export function Calendario({ me }: { me: Me }) {
  const canEdit = can(me, 'rh.estructura.gestionar') && writable(me, 'rh');
  const [year, setYear] = useState(new Date().getFullYear() < 2027 ? 2027 : new Date().getFullYear());
  const [data, setData] = useState<CalendarData | null>(null);
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<CalendarData>(`/api/rh/calendar?year=${year}`));
    } catch {
      setError('No se pudo cargar el calendario.');
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/api/rh/calendar', { body: { day, name } });
      setDay('');
      setName('');
      if (day.slice(0, 4) !== String(year)) setYear(Number(day.slice(0, 4)));
      else await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el día.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: string) {
    setError(null);
    try {
      await api(`/api/rh/calendar/${d}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo quitar el día.');
    }
  }

  const rows = [
    ...(data?.official ?? []).map((h) => ({ day: h.date, name: h.name, own: false })),
    ...(data?.company ?? []).map((d) => ({ day: d.day, name: d.name, own: true })),
  ].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <section className="sheet stack">
      <div className="toolbar" style={{ margin: 0 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Calendario laboral {year}</h2>
        <button className="btn quiet small" onClick={() => setYear(year - 1)} aria-label="Año anterior">
          ‹
        </button>
        <button className="btn quiet small" onClick={() => setYear(year + 1)} aria-label="Año siguiente">
          ›
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Los días de descanso obligatorio de la ley (art. 74 de la LFT) ya están incluidos. Agrega los días que tu empresa también descansa: no
        cuentan como vacaciones y, si alguien trabaja, el reporte de jornada lo marca.
      </p>
      {error && <div className="notice error">{error}</div>}
      {!data ? (
        <p className="muted">Cargando…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.day)}</td>
                  <td>{r.name}</td>
                  <td className="muted">{r.own ? 'De la empresa' : 'Ley'}</td>
                  <td className="num">
                    {r.own && canEdit && (
                      <button className="btn quiet small" onClick={() => void remove(r.day)}>
                        Quitar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <form className="form-grid" onSubmit={add}>
          <label className="field">
            Fecha
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </label>
          <label className="field">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Día de las madres" maxLength={80} required />
          </label>
          <button className="btn solid" disabled={busy} style={{ alignSelf: 'end' }}>
            {busy ? 'Guardando…' : 'Agregar día'}
          </button>
        </form>
      )}
    </section>
  );
}
