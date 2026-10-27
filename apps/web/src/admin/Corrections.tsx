import { useState, type FormEvent } from 'react';
import { localDate, PUNCH_LABELS, type PunchKind } from '@jornadia/core';
import { formatTime, serverNow } from '../lib/clock';
import { supabase } from '../lib/supabase';
import { zonedToIso } from '../lib/tz';
import { punchTime, type Me, type PunchRow } from '../types';

interface Props {
  me: Me;
  employees: { id: string; full_name: string; employee_number: string }[];
  /** null = agregar una checada que faltó */
  punch: PunchRow | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Correcciones con motivo obligatorio. La checada original nunca se modifica:
 * se guarda una corrección que queda en la bitácora y en el reporte.
 */
export function Corrections({ me, employees, punch, onClose, onSaved }: Props) {
  const tz = me.company!.timezone;
  const [action, setAction] = useState<'adjust_time' | 'void'>('adjust_time');
  const [employeeId, setEmployeeId] = useState(punch?.employee_id ?? '');
  const [kind, setKind] = useState<PunchKind>('out');
  const [when, setWhen] = useState(() => {
    const base = punch ? punchTime(punch) : serverNow().toISOString();
    return `${localDate(base, tz)}T${formatTime(base, tz)}`;
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data: session } = await supabase.auth.getSession();
    const row: Record<string, unknown> = punch
      ? {
          company_id: me.company!.id,
          employee_id: punch.employee_id,
          punch_id: punch.id,
          action,
          corrected_ts: action === 'adjust_time' ? zonedToIso(when, tz) : null,
          reason: reason.trim(),
          made_by: session.session?.user.id,
        }
      : {
          company_id: me.company!.id,
          employee_id: employeeId,
          action: 'add' as const,
          kind,
          corrected_ts: zonedToIso(when, tz),
          reason: reason.trim(),
          made_by: session.session?.user.id,
        };
    const { error: err } = await supabase.from('punch_corrections').insert(row);
    setBusy(false);
    if (err) setError('No se pudo guardar la corrección. Verifica los datos.');
    else onSaved();
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-labelledby="corr-title">
      <form className="sheet" onSubmit={submit} style={{ width: 'min(100%, 460px)' }}>
        <h2 id="corr-title">{punch ? 'Corregir checada' : 'Agregar checada faltante'}</h2>
        {punch ? (
          <p className="muted">
            {PUNCH_LABELS[punch.kind]} de {punch.employees?.full_name} a las {formatTime(punchTime(punch), tz)}. El registro original se
            conserva; la corrección queda en la bitácora.
          </p>
        ) : (
          <p className="muted">Úsalo cuando un trabajador olvidó checar. Quedará marcada como captura manual en el reporte.</p>
        )}

        {punch ? (
          <div className="segmented" role="group" aria-label="Tipo de corrección">
            <button type="button" aria-pressed={action === 'adjust_time'} onClick={() => setAction('adjust_time')}>
              Cambiar hora
            </button>
            <button type="button" aria-pressed={action === 'void'} onClick={() => setAction('void')}>
              Anular
            </button>
          </div>
        ) : (
          <>
            <label className="field">
              Trabajador
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
                <option value="">Selecciona…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name} ({e.employee_number})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Checada
              <select value={kind} onChange={(e) => setKind(e.target.value as PunchKind)}>
                {(Object.keys(PUNCH_LABELS) as PunchKind[]).map((k) => (
                  <option key={k} value={k}>
                    {PUNCH_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {(!punch || action === 'adjust_time') && (
          <label className="field">
            Fecha y hora correctas
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </label>
        )}

        <label className="field">
          Motivo
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. olvidó checar al salir de la obra" minLength={5} required />
          <small>Obligatorio. Se muestra en el reporte para la STPS.</small>
        </label>

        {error && <div className="notice error">{error}</div>}

        <div className="toolbar">
          <button className="btn solid" type="submit" disabled={busy || reason.trim().length < 5 || (!punch && !employeeId)}>
            {busy ? 'Guardando…' : 'Guardar corrección'}
          </button>
          <button className="btn quiet" type="button" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
