import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  classifyShift,
  dayWorkMinutes,
  formatMinutes,
  isValidTime,
  scheduleErrors,
  scheduleKind,
  scheduleWarnings,
  SHIFT_LABELS,
  WEEKDAY_NAMES,
  weeklyScheduledMinutes,
  type ScheduleDay,
} from '@korporia/jornada';
import { api, ApiError } from '../../../lib/api';
import { can } from '../../../lib/access';
import { Modal } from '../../../common';
import type { Me } from '../../../types';
import { weeklyLimit } from '../types';

interface Schedule {
  id: string;
  name: string;
  days: ScheduleDay[];
  tolerance_minutes: number;
  assigned: number;
}
interface Person {
  id: string;
  employee_number: string;
  full_name: string;
  position: string | null;
  default_site_id: string | null;
  department_id: string | null;
  schedule_id: string | null;
}
interface Data {
  schedules: Schedule[];
  employees: Person[];
  departments: { id: string; name: string }[];
}

const WEEK = [1, 2, 3, 4, 5, 6, 7];
const short = (weekday: number) => (WEEKDAY_NAMES[weekday] ?? '').slice(0, 3);

/** Resumen corto de los días: "Lun–Vie 09:00–18:00 · Sáb 09:00–14:00". */
function summary(days: ScheduleDay[]): string {
  const groups: { from: number; to: number; text: string }[] = [];
  for (const d of days) {
    const text = `${d.start}–${d.end}`;
    const last = groups[groups.length - 1];
    if (last && last.text === text && last.to === d.weekday - 1) last.to = d.weekday;
    else groups.push({ from: d.weekday, to: d.weekday, text });
  }
  return groups.map((g) => `${short(g.from)}${g.to !== g.from ? `–${short(g.to)}` : ''} ${g.text}`).join(' · ');
}

/** JOR-10: horarios (horas por día) y su asignación a una persona, a varias, a un área o a una obra. */
export function Schedules({ me }: { me: Me }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [assigning, setAssigning] = useState<Schedule | null>(null);
  const canConfigure = can(me, 'jornada.configurar');
  const limit = weeklyLimit(me.jornada, new Date().getFullYear());

  const load = useCallback(async () => {
    try {
      setData(await api<Data>('/api/jornada/schedules'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los horarios.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(s: Schedule) {
    if (!window.confirm(`¿Quitar el horario "${s.name}"?${s.assigned ? ` ${s.assigned} persona(s) quedarán sin horario.` : ''}`)) return;
    try {
      await api(`/api/jornada/schedules/${s.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo quitar el horario.');
    }
  }

  const without = data?.employees.filter((e) => !e.schedule_id).length ?? 0;

  return (
    <div className="content">
      <h1>Horarios</h1>
      <p className="muted">
        El horario es la referencia de cada persona: no impide checar y el reporte marca lo trabajado fuera de él. Korporia avisa si un horario
        pasa los límites de la ley (8 h diurna, 7 h nocturna, 7 h 30 min mixta y el tope semanal de {limit} h).
      </p>
      {error && <div className="notice error">{error}</div>}
      {canConfigure && (
        <button className="btn solid" onClick={() => setEditing('new')}>
          Nuevo horario
        </button>
      )}
      {!data ? (
        <p className="muted">Cargando…</p>
      ) : !data.schedules.length ? (
        <p className="muted" style={{ marginTop: 16 }}>
          Aún no tienes horarios. Crea el primero, por ejemplo "Oficina" de lunes a viernes de 9:00 a 18:00.
        </p>
      ) : (
        <div className="stack" style={{ marginTop: 16 }}>
          {data.schedules.map((s) => {
            const warnings = scheduleWarnings(s.days, limit);
            const kind = scheduleKind(s.days);
            return (
              <section key={s.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ margin: 0 }}>{s.name}</h2>
                    <div className="muted">
                      {kind ? `Jornada ${SHIFT_LABELS[kind].toLowerCase()}` : ''} · {formatMinutes(weeklyScheduledMinutes(s.days))} por semana · tolerancia{' '}
                      {s.tolerance_minutes} min
                    </div>
                    <div style={{ marginTop: 4 }}>{summary(s.days)}</div>
                    <div className="muted" style={{ fontSize: '0.9rem' }}>
                      {s.assigned === 1 ? '1 persona' : `${s.assigned} personas`}
                    </div>
                  </div>
                  {canConfigure && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <button className="btn small solid" onClick={() => setAssigning(s)}>
                        Asignar
                      </button>
                      <button className="btn small" onClick={() => setEditing(s)}>
                        Editar
                      </button>
                      <button className="btn small quiet" onClick={() => void remove(s)}>
                        Quitar
                      </button>
                    </div>
                  )}
                </div>
                {warnings.length > 0 && (
                  <div className="notice warn" style={{ marginTop: 8 }}>
                    {warnings.map((w) => (
                      <div key={w}>{w}</div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {without > 0 && (
            <p className="muted">
              {without === 1 ? '1 persona activa no tiene horario.' : `${without} personas activas no tienen horario.`} Usa "Asignar" en un horario.
            </p>
          )}
        </div>
      )}

      {editing && (
        <ScheduleEditor
          schedule={editing === 'new' ? null : editing}
          limit={limit}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {assigning && data && (
        <AssignSchedule
          me={me}
          schedule={assigning}
          data={data}
          onClose={() => setAssigning(null)}
          onSaved={async () => {
            setAssigning(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

type Row = { on: boolean; start: string; end: string; breakMinutes: string };
const OFF: Row = { on: false, start: '09:00', end: '18:00', breakMinutes: '60' };
const rowOf = (r: Record<number, Row>, w: number): Row => r[w] ?? OFF;

function ScheduleEditor({ schedule, limit, onClose, onSaved }: { schedule: Schedule | null; limit: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(schedule?.name ?? '');
  const [tolerance, setTolerance] = useState(String(schedule?.tolerance_minutes ?? 10));
  const [rows, setRows] = useState<Record<number, Row>>(() =>
    Object.fromEntries(
      WEEK.map((w) => {
        const d = schedule?.days.find((x) => x.weekday === w);
        return [w, d ? { on: true, start: d.start, end: d.end, breakMinutes: String(d.breakMinutes) } : { on: !schedule && w <= 5, start: '09:00', end: '18:00', breakMinutes: '60' }];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days: ScheduleDay[] = useMemo(
    () => WEEK.map((w) => [w, rowOf(rows, w)] as const).filter(([, r]) => r.on).map(([w, r]) => ({ weekday: w, start: r.start, end: r.end, breakMinutes: Number(r.breakMinutes || 0) })),
    [rows],
  );
  const errors = scheduleErrors(days);
  const warnings = scheduleWarnings(days, limit);
  const set = (w: number, patch: Partial<Row>) => setRows((r) => ({ ...r, [w]: { ...rowOf(r, w), ...patch } }));

  function copyFirst() {
    const first = WEEK.find((w) => rowOf(rows, w).on);
    if (!first) return;
    setRows((r) => Object.fromEntries(WEEK.map((w) => [w, rowOf(r, w).on ? { ...rowOf(r, first), on: true } : rowOf(r, w)])));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (errors.length || name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), days, tolerance_minutes: Number(tolerance || 0) };
      if (schedule) await api(`/api/jornada/schedules/${schedule.id}`, { method: 'PATCH', body });
      else await api('/api/jornada/schedules', { body });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el horario.');
      setBusy(false);
    }
  }

  return (
    <Modal title={schedule ? 'Editar horario' : 'Nuevo horario'} onClose={onClose} width={640}>
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <label className="field">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Oficina, Turno nocturno…" maxLength={60} required />
          </label>
          <label className="field">
            Tolerancia (minutos)
            <input type="number" min={0} max={120} value={tolerance} onChange={(e) => setTolerance(e.target.value)} inputMode="numeric" />
            <small>Lo que se checa dentro de este margen no cuenta como fuera de horario.</small>
          </label>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {WEEK.map((w) => {
            const r = rowOf(rows, w);
            const valid = r.on && isValidTime(r.start) && isValidTime(r.end) && r.start !== r.end;
            const day = { weekday: w, start: r.start, end: r.end, breakMinutes: Number(r.breakMinutes || 0) };
            return (
              <div key={w} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <label className="check" style={{ margin: 0 }}>
                    <input type="checkbox" checked={r.on} onChange={(e) => set(w, { on: e.target.checked })} />
                    <span>
                      <strong>{WEEKDAY_NAMES[w]}</strong>
                    </span>
                  </label>
                  <span className="muted" style={{ fontSize: '0.9rem' }}>
                    {valid ? `${SHIFT_LABELS[classifyShift(day)]} · ${formatMinutes(dayWorkMinutes(day))}` : r.on ? '—' : 'Descanso'}
                  </span>
                </div>
                {r.on && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 4 }}>
                    <label className="field" style={{ margin: 0 }}>
                      <small>Entrada</small>
                      <input type="time" value={r.start} onChange={(e) => set(w, { start: e.target.value })} style={{ minWidth: 0, width: '100%' }} aria-label={`Entrada ${WEEKDAY_NAMES[w]}`} />
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <small>Salida</small>
                      <input type="time" value={r.end} onChange={(e) => set(w, { end: e.target.value })} style={{ minWidth: 0, width: '100%' }} aria-label={`Salida ${WEEKDAY_NAMES[w]}`} />
                    </label>
                    <label className="field" style={{ margin: 0 }}>
                      <small>Comida (min.)</small>
                      <input
                        type="number"
                        min={0}
                        max={240}
                        inputMode="numeric"
                        value={r.breakMinutes}
                        onChange={(e) => set(w, { breakMinutes: e.target.value })}
                        style={{ minWidth: 0, width: '100%' }}
                        aria-label={`Comida ${WEEKDAY_NAMES[w]}`}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn small quiet" onClick={copyFirst}>
            Copiar el primer día a los demás
          </button>
          <strong>{formatMinutes(weeklyScheduledMinutes(days))} por semana</strong>
        </div>
        {errors.length > 0 && <div className="notice error">{errors[0]}</div>}
        {warnings.length > 0 && (
          <div className="notice warn">
            <strong>Revisa con tu asesor laboral</strong>
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}
        {error && <div className="notice error">{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn solid" disabled={busy || errors.length > 0 || name.trim().length < 2}>
            {busy ? 'Guardando…' : warnings.length ? 'Guardar de todos modos' : 'Guardar'}
          </button>
          <button type="button" className="btn quiet" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AssignSchedule({ me, schedule, data, onClose, onSaved }: { me: Me; schedule: Schedule; data: Data; onClose: () => void; onSaved: () => Promise<void> }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(data.employees.filter((e) => e.schedule_id === schedule.id).map((e) => e.id)));
  const [department, setDepartment] = useState('');
  const [site, setSite] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scheduleName = new Map(data.schedules.map((s) => [s.id, s.name]));
  const initial = useMemo(() => new Set(data.employees.filter((e) => e.schedule_id === schedule.id).map((e) => e.id)), [data, schedule.id]);

  const visible = data.employees.filter(
    (e) =>
      (!department || e.department_id === department) &&
      (!site || e.default_site_id === site) &&
      (!search.trim() || `${e.full_name} ${e.employee_number}`.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const allVisible = visible.length > 0 && visible.every((e) => selected.has(e.id));
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const toggleVisible = () => setSelected((s) => {
    const n = new Set(s);
    for (const e of visible) {
      if (allVisible) n.delete(e.id);
      else n.add(e.id);
    }
    return n;
  });

  const added = [...selected].filter((id) => !initial.has(id));
  const removed = [...initial].filter((id) => !selected.has(id));
  const moving = added.filter((id) => data.employees.find((e) => e.id === id)?.schedule_id).length;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (added.length) await api('/api/jornada/schedules/assign', { body: { schedule_id: schedule.id, employee_ids: added } });
      if (removed.length) await api('/api/jornada/schedules/assign', { body: { schedule_id: null, employee_ids: removed } });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo asignar el horario.');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Asignar "${schedule.name}"`} onClose={onClose} width={620}>
      <div className="stack">
        <div className="form-grid">
          {data.departments.length > 0 && (
            <label className="field">
              Área
              <select value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">Todas</option>
                {data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(me.sites?.length ?? 0) > 0 && (
            <label className="field">
              Obra
              <select value={site} onChange={(e) => setSite(e.target.value)}>
                <option value="">Todas</option>
                {me.sites!.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Buscar
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o número" />
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="muted">No hay personas activas con esos filtros.</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>
                    <label className="check" style={{ margin: 0 }}>
                      <input type="checkbox" checked={allVisible} onChange={toggleVisible} />
                      <span>{allVisible ? 'Quitar a todos' : 'Elegir a todos'}</span>
                    </label>
                  </th>
                  <th>Horario actual</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <label className="check" style={{ margin: 0 }}>
                        <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                        <span>
                          {e.full_name} <span className="muted">· {e.employee_number}</span>
                        </span>
                      </label>
                    </td>
                    <td className="muted">{e.schedule_id ? scheduleName.get(e.schedule_id) ?? '—' : 'Sin horario'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {moving > 0 && (
          <div className="notice warn">{moving === 1 ? '1 persona cambiará de horario.' : `${moving} personas cambiarán de horario.`}</div>
        )}
        {error && <div className="notice error">{error}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn solid" onClick={() => void save()} disabled={busy || (!added.length && !removed.length)}>
            {busy ? 'Guardando…' : `Guardar (${selected.size} ${selected.size === 1 ? 'persona' : 'personas'})`}
          </button>
          <button className="btn quiet" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
