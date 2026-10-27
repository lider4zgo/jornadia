import { useCallback, useEffect, useState } from 'react';
import { formatMinutes, localDate, weekStart } from '@jornadia/core';
import { api, ApiError } from '../lib/api';
import { serverNow } from '../lib/clock';
import type { Me } from '../types';

interface ReportRow {
  employee: { id: string; employee_number: string; full_name: string; position: string | null };
  weeks: { weekStart: string; workedMinutes: number; overtimeMinutes: number; nearLimit: boolean; limitHours: number }[];
  totals: { workedMinutes: number; overtimeMinutes: number; incompleteShifts: number; correctedPunches: number; flaggedPunches: number };
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Reporte de jornada por periodo, exportable para nómina y para la STPS. */
export function Report({ me }: { me: Me }) {
  const tz = me.company!.timezone;
  const monday = weekStart(localDate(serverNow(), tz));
  const [from, setFrom] = useState(monday);
  const [to, setTo] = useState(addDays(monday, 6));
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const r = await api<{ report: ReportRow[] }>(`/api/reports/jornada?from=${from}&to=${to}`);
      setRows(r.report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo generar el reporte.');
      setRows([]);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download() {
    setDownloading(true);
    try {
      const res = await api<Response>(`/api/reports/jornada?from=${from}&to=${to}&format=csv`, { raw: true, timeoutMs: 60000 });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `jornada_${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el archivo.');
    } finally {
      setDownloading(false);
    }
  }

  const limit = me.company!.weekly_hour_limit;

  return (
    <div className="content">
      <h1>Reporte de jornada</h1>
      <div className="toolbar">
        <label className="field">
          Desde
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          Hasta
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn solid" onClick={() => void download()} disabled={downloading || !rows?.length}>
          {downloading ? 'Preparando…' : 'Descargar para Excel'}
        </button>
      </div>
      <p className="muted">
        Tope semanal configurado: {limit} h. Las checadas sin salida no suman horas hasta corregirse. El archivo incluye entradas,
        salidas, comidas y horas extra por semana.
      </p>

      {error && <div className="notice error">{error}</div>}

      {!rows ? (
        <p className="muted">Generando…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No hay trabajadores en este periodo.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trabajador</th>
                <th className="num">Trabajado</th>
                <th className="num">Horas extra</th>
                <th className="num">Sin salida</th>
                <th className="num">Corregidas</th>
                <th className="num">Por revisar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employee.id}>
                  <td>
                    {r.employee.full_name}
                    <div className="muted" style={{ fontSize: '0.85rem' }}>Núm. {r.employee.employee_number}</div>
                  </td>
                  <td className="num">{formatMinutes(r.totals.workedMinutes)}</td>
                  <td className="num" style={{ color: r.totals.overtimeMinutes ? 'var(--stop)' : undefined }}>
                    {r.totals.overtimeMinutes ? formatMinutes(r.totals.overtimeMinutes) : '—'}
                  </td>
                  <td className="num">{r.totals.incompleteShifts || '—'}</td>
                  <td className="num">{r.totals.correctedPunches || '—'}</td>
                  <td className="num">{r.totals.flaggedPunches || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
