import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { can, writable } from '../../lib/access';
import type { Me } from '../../types';
import { LeaveList, RecordLeave } from './Expedientes';
import type { Leave } from './shared';

/** Bandeja de solicitudes de vacaciones y permisos, y registro de incapacidades. */
export function Ausencias({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [filter, setFilter] = useState<'pendiente' | 'todas'>('pendiente');
  const [leaves, setLeaves] = useState<Leave[] | null>(null);
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canApprove = can(me, 'rh.ausencias.aprobar') && writable(me, 'rh');

  const load = useCallback(() => {
    api<{ leaves: Leave[] }>(`/api/rh/leaves${filter === 'pendiente' ? '?status=pendiente' : ''}`)
      .then((r) => setLeaves(r.leaves))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar las solicitudes.'));
  }, [filter]);
  useEffect(load, [load]);
  useEffect(() => {
    api<{ people: { id: string; full_name: string }[] }>('/api/rh/structure').then((r) => setPeople(r.people)).catch(() => undefined);
  }, []);

  return (
    <div className="stack">
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>Vacaciones y ausencias</h1>
        {canApprove && (
          <button className="btn solid" onClick={() => setRecording(true)}>
            Registrar ausencia
          </button>
        )}
      </div>
      <div className="segmented" role="group" aria-label="Filtro">
        <button aria-pressed={filter === 'pendiente'} onClick={() => setFilter('pendiente')}>
          Por aprobar
        </button>
        <button aria-pressed={filter === 'todas'} onClick={() => setFilter('todas')}>
          Todas
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {!leaves ? (
        <p className="muted">Cargando…</p>
      ) : leaves.length === 0 && filter === 'pendiente' ? (
        <p className="muted">No hay solicitudes por aprobar.</p>
      ) : (
        <LeaveList
          leaves={leaves}
          canApprove={canApprove}
          showName
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
      {recording && (
        <RecordLeave
          employees={people}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            load();
          }}
        />
      )}
    </div>
  );
}
