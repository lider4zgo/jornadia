import { useCallback, useEffect, useState } from 'react';
import { localDate, PUNCH_LABELS } from '@jornadia/core';
import { api, fetchBlobUrl } from '../lib/api';
import { formatTime, serverNow } from '../lib/clock';
import { supabase } from '../lib/supabase';
import { startOfLocalDay } from '../lib/tz';
import { FLAG_LABELS, punchTime, type Me, type PunchRow } from '../types';
import { Corrections } from './Corrections';

interface EmployeeLite {
  id: string;
  employee_number: string;
  full_name: string;
}

const REVIEW_FLAGS = new Set(['outside_geofence', 'impossible_jump', 'face_mismatch', 'liveness_failed', 'out_of_sequence', 'late_sync', 'device_clock_ahead']);

/** Panel en vivo: quién ha checado hoy, dónde y qué requiere revisión. */
export function Today({ me }: { me: Me }) {
  const tz = me.company!.timezone;
  const canCorrect = me.role === 'owner' || me.role === 'admin';
  const [rows, setRows] = useState<PunchRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [onlyReview, setOnlyReview] = useState(false);
  const [correcting, setCorrecting] = useState<PunchRow | 'new' | null>(null);

  const today = localDate(serverNow(), tz);

  const load = useCallback(async () => {
    try {
      const [p, e] = await Promise.all([
        api<{ punches: PunchRow[] }>(`/api/punches?from=${encodeURIComponent(startOfLocalDay(today, tz))}&limit=1000`),
        supabase.from('employees').select('id, employee_number, full_name').eq('company_id', me.company!.id).eq('active', true).order('full_name'),
      ]);
      setRows(p.punches);
      setEmployees((e.data ?? []) as EmployeeLite[]);
      setError(null);
    } catch {
      setError('No se pudieron cargar las checadas de hoy.');
    } finally {
      setLoading(false);
    }
  }, [today, tz, me.company]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function openPhoto(path: string) {
    try {
      setPhoto(await fetchBlobUrl(`/api/files?path=${encodeURIComponent(path)}`));
    } catch {
      setError('No se pudo abrir la foto.');
    }
  }

  const checkedIn = new Set(rows.filter((r) => r.kind === 'in').map((r) => r.employee_id));
  const missing = employees.filter((e) => !checkedIn.has(e.id));
  const visible = onlyReview ? rows.filter((r) => r.flags.some((f) => REVIEW_FLAGS.has(f))) : rows;
  const reviewCount = rows.filter((r) => r.flags.some((f) => REVIEW_FLAGS.has(f))).length;

  return (
    <div className="content">
      <div className="toolbar">
        <div className="grow" style={{ flex: 1 }}>
          <h1>Hoy</h1>
          <p className="muted">
            {checkedIn.size} de {employees.length} trabajadores han registrado entrada. Se actualiza cada minuto.
          </p>
        </div>
        {canCorrect && (
          <button className="btn small" onClick={() => setCorrecting('new')}>
            Agregar checada faltante
          </button>
        )}
        <button className="btn small" onClick={() => void load()}>
          Actualizar
        </button>
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="chips">
        <button className={`chip ${!onlyReview ? 'go' : ''}`} onClick={() => setOnlyReview(false)} aria-pressed={!onlyReview}>
          Todas ({rows.length})
        </button>
        <button className={`chip ${onlyReview ? 'stop' : ''}`} onClick={() => setOnlyReview(true)} aria-pressed={onlyReview}>
          Por revisar ({reviewCount})
        </button>
      </div>

      {loading ? (
        <p className="muted">Cargando…</p>
      ) : visible.length === 0 ? (
        <p className="muted">{onlyReview ? 'No hay checadas por revisar.' : 'Todavía no hay checadas hoy.'}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Selfie</th>
                <th>Trabajador</th>
                <th>Checada</th>
                <th>Obra</th>
                <th>Observaciones</th>
                {canCorrect && <th><span className="sr-only">Acciones</span></th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="num">{formatTime(punchTime(r), tz)}</td>
                  <td>
                    {r.selfie_path && (
                      <button className="thumb" onClick={() => void openPhoto(r.selfie_path!)} aria-label={`Ver selfie de ${r.employees?.full_name}`}>
                        <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
                          <circle cx="12" cy="9" r="4" fill="#52627A" />
                          <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="#52627A" />
                        </svg>
                      </button>
                    )}
                  </td>
                  <td>
                    {r.employees?.full_name}
                    <div className="muted" style={{ fontSize: '0.85rem' }}>Núm. {r.employees?.employee_number}</div>
                  </td>
                  <td>{PUNCH_LABELS[r.kind]}</td>
                  <td>
                    {r.sites?.name ?? 'Sin obra'}
                    {r.distance_m != null && <div className="muted" style={{ fontSize: '0.85rem' }}>a {r.distance_m} m</div>}
                  </td>
                  <td>
                    <div className="chips">
                      {r.flags
                        .filter((f) => f !== 'consent_missing')
                        .map((f) => (
                          <span key={f} className={`chip ${REVIEW_FLAGS.has(f) ? 'stop' : 'warn'}`}>
                            {FLAG_LABELS[f] ?? f}
                          </span>
                        ))}
                      {r.face_score != null && <span className="chip">Rostro {Math.round(r.face_score * 100)} %</span>}
                    </div>
                  </td>
                  {canCorrect && (
                    <td>
                      <button className="btn small quiet" onClick={() => setCorrecting(r)}>
                        Corregir
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {missing.length > 0 && (
        <section className="stack">
          <h2>Sin entrada hoy ({missing.length})</h2>
          <p className="muted">{missing.map((e) => e.full_name).join(', ')}</p>
        </section>
      )}

      {photo && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Selfie" onClick={() => setPhoto(null)}>
          <img src={photo} alt="Selfie de la checada" />
        </div>
      )}

      {correcting && (
        <Corrections
          me={me}
          employees={employees}
          punch={correcting === 'new' ? null : correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
