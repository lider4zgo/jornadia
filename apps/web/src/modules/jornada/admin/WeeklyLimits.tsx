import { useState } from 'react';
import { weeklyHourLimitForYear } from '@korporia/jornada';
import { supabase } from '../../../lib/supabase';
import type { Me } from '../../../types';

/**
 * JOR-16: tope semanal de jornada por año. Sin valor propio se usa el de la ley,
 * que baja de 46 h en 2027 a 40 h en 2030. La empresa puede fijar uno menor (o el que
 * acuerde por escrito) para cada año.
 */
export function WeeklyLimits({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const company = me.company!;
  const current = new Date().getFullYear();
  const years = [current, current + 1, current + 2, current + 3].filter((y) => y >= 2027 || y === current);
  const saved = me.jornada?.settings?.weekly_limits ?? {};
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(years.map((y) => [String(y), saved[String(y)] != null ? String(saved[String(y)]) : ''])),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setStatus(null);
    const next: Record<string, number> = {};
    for (const [year, raw] of Object.entries(values)) {
      if (!raw.trim()) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1 || n > 72) {
        setError(`El tope de ${year} debe estar entre 1 y 72 horas.`);
        return;
      }
      next[year] = Math.round(n * 2) / 2;
    }
    setBusy(true);
    const { data, error: err } = await supabase
      .schema('jornada')
      .from('settings')
      .update({ weekly_limits: next })
      .eq('company_id', company.id)
      .select('company_id');
    setBusy(false);
    if (err || !data?.length) setError('No tienes permiso para cambiar los topes.');
    else {
      setStatus('Topes guardados.');
      onChanged();
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Tope semanal de jornada</h2>
      <p className="muted">
        Arriba de este tope las horas cuentan como extra en el reporte. Déjalo vacío para usar el de la ley de cada año.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Año</th>
              <th className="num">Ley</th>
              <th className="num">Tu empresa (horas)</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td>{y}</td>
                <td className="num">{weeklyHourLimitForYear(y)} h</td>
                <td className="num">
                  <input
                    type="number"
                    min={1}
                    max={72}
                    step={0.5}
                    inputMode="decimal"
                    placeholder={String(weeklyHourLimitForYear(y))}
                    value={values[String(y)] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [String(y)]: e.target.value }))}
                    style={{ width: 90, textAlign: 'right' }}
                    aria-label={`Tope de ${y}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <div className="notice error">{error}</div>}
      {status && <div className="notice">{status}</div>}
      <button className="btn solid" onClick={() => void save()} disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar topes'}
      </button>
    </section>
  );
}
