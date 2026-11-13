import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CONTRACT_TYPES,
  SAT_CONTRACT_REGIMES,
  DOCUMENT_KINDS,
  INCAPACITY_TYPES,
  isValidCurp,
  isValidNss,
  isValidRfc,
  LEAVE_KINDS,
  ONBOARDING_DOCUMENTS,
  type DocumentKind,
  type LeaveKind,
} from '@korporia/core';
import { api, ApiError } from '../../lib/api';
import { can, writable } from '../../lib/access';
import { Modal } from '../../common';
import type { Me } from '../../types';
import { CredentialCard, type Credentials } from '../jornada/admin/People';
import { DocumentUpload, LeaveStatusChip, leaveLabel, openDocument, shortDate, sizeLabel, WEEKDAYS, type Balance, type Leave, type StoredDocument } from './shared';
import type { Structure } from './Organigrama';

interface Row {
  id: string;
  employee_number: string;
  full_name: string;
  position: string | null;
  active: boolean;
  hired_at: string | null;
  department_id: string | null;
  position_id: string | null;
  contract_end: string | null;
  missing_documents: DocumentKind[];
  alerts: string[];
}

const ALERT_LABEL: Record<string, string> = {
  contrato_vencido: 'Contrato vencido',
  contrato_por_vencer: 'Contrato por vencer',
  prueba_por_terminar: 'Termina periodo de prueba',
};

/** Expedientes del personal, alertas y alta guiada. */
export function Expedientes({ me }: { me: Me }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [structure, setStructure] = useState<Structure | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = can(me, 'rh.expediente.gestionar') && writable(me, 'rh');
  const canHire = can(me, 'core.personal.gestionar') && writable(me, 'core');

  const load = useCallback(async () => {
    try {
      const [list, s] = await Promise.all([api<{ employees: Row[] }>('/api/rh/employees'), api<Structure>('/api/rh/structure')]);
      setRows(list.employees);
      setStructure(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar el personal.');
    }
  }, []);
  useEffect(() => void load(), [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (rows ?? []).filter((r) => (showInactive || r.active) && (!q || `${r.full_name} ${r.employee_number}`.toLowerCase().includes(q)));
  }, [rows, filter, showInactive]);
  const name = (list: { id: string; name: string }[] | undefined, id: string | null) => list?.find((x) => x.id === id)?.name ?? null;
  const activeCount = rows?.filter((r) => r.active).length ?? 0;
  const limit = me.company?.subscription?.employee_limit ?? 0;

  if (selected) {
    return <Expediente me={me} id={selected} structure={structure} onBack={() => { setSelected(null); void load(); }} />;
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <h1>Expedientes</h1>
          <p className="muted" style={{ margin: 0 }}>
            {activeCount} de {limit} colaboradores activos en tu plan.
          </p>
        </div>
        {canHire && (
          <button className="btn solid" onClick={() => setCreating(true)} disabled={activeCount >= limit}>
            Alta guiada
          </button>
        )}
      </div>
      <div className="toolbar">
        <label className="field" style={{ flex: 1 }}>
          <span className="sr-only">Buscar</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar por nombre o número" />
        </label>
        <label className="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          <span>Ver bajas</span>
        </label>
      </div>
      {error && <div className="notice error">{error}</div>}
      {!rows ? (
        <p className="muted">Cargando…</p>
      ) : visible.length === 0 ? (
        <p className="muted">{rows.length === 0 ? 'Aún no hay colaboradores. Empieza con la alta guiada.' : 'Sin resultados.'}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Núm.</th>
                <th>Nombre</th>
                <th>Puesto y área</th>
                <th>Ingreso</th>
                <th>Pendientes</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} onClick={() => setSelected(r.id)} style={{ cursor: 'pointer', opacity: r.active ? 1 : 0.55 }}>
                  <td>{r.employee_number}</td>
                  <td>
                    <button className="link-button" onClick={() => setSelected(r.id)}>
                      {r.full_name}
                    </button>
                    {!r.active && <span className="chip stop" style={{ marginLeft: 6 }}>Baja</span>}
                  </td>
                  <td>
                    {name(structure?.positions, r.position_id) ?? r.position ?? '—'}
                    <div className="muted" style={{ fontSize: '0.85rem' }}>{name(structure?.departments, r.department_id) ?? ''}</div>
                  </td>
                  <td>{shortDate(r.hired_at)}</td>
                  <td>
                    {r.alerts.map((a) => (
                      <span key={a} className="chip warn" style={{ marginRight: 4 }}>
                        {ALERT_LABEL[a] ?? a}
                      </span>
                    ))}
                    {r.active && r.missing_documents.length > 0 && <span className="chip">{r.missing_documents.length} documento(s)</span>}
                    {r.active && !r.hired_at && <span className="chip">Sin fecha de ingreso</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && structure && (
        <Alta
          me={me}
          structure={structure}
          canEdit={canEdit}
          onClose={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

interface Detail {
  employee: Record<string, string | null | boolean> & { id: string; full_name: string; employee_number: string; active: boolean };
  profile: Record<string, unknown> | null;
  documents: StoredDocument[];
  missing_documents: DocumentKind[];
  leaves: Leave[];
  balance: Balance | null;
  quota: { usedBytes: number; limitBytes: number | null; maxFileBytes: number };
  today: string;
}

type DetailTab = 'datos' | 'documentos' | 'ausencias';

function Expediente({ me, id, structure, onBack }: { me: Me; id: string; structure: Structure | null; onBack: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [tab, setTab] = useState<DetailTab>('datos');
  const [error, setError] = useState<string | null>(null);
  const canEdit = can(me, 'rh.expediente.gestionar') && writable(me, 'rh');
  const canApprove = can(me, 'rh.ausencias.aprobar') && writable(me, 'rh');
  const load = useCallback(() => {
    api<Detail>(`/api/rh/employees/${id}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar el expediente.'));
  }, [id]);
  useEffect(load, [load]);

  return (
    <div className="stack">
      <button className="btn quiet small" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        ← Expedientes
      </button>
      {error && <div className="notice error">{error}</div>}
      {!data ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          <div>
            <h1 style={{ marginBottom: 2 }}>{data.employee.full_name}</h1>
            <p className="muted" style={{ margin: 0 }}>
              Número {data.employee.employee_number}
              {!data.employee.active ? ' · dado de baja' : ''}
            </p>
          </div>
          <nav className="panel-nav" aria-label="Expediente">
            {(['datos', 'documentos', 'ausencias'] as DetailTab[]).map((t) => (
              <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
                {t === 'datos' ? 'Datos' : t === 'documentos' ? `Documentos (${data.documents.length})` : 'Vacaciones y ausencias'}
              </button>
            ))}
          </nav>
          {tab === 'datos' && <ProfileForm data={data} structure={structure} canEdit={canEdit} onSaved={load} />}
          {tab === 'documentos' && <Documents data={data} canEdit={canEdit} onChanged={load} />}
          {tab === 'ausencias' && <Absences data={data} canApprove={canApprove} onChanged={load} />}
        </>
      )}
    </div>
  );
}

const str = (v: unknown) => (v == null ? '' : String(v));

function ProfileForm({ data, structure, canEdit, onSaved }: { data: Detail; structure: Structure | null; canEdit: boolean; onSaved: () => void }) {
  const e = data.employee;
  const p = data.profile ?? {};
  const [f, setF] = useState<Record<string, string>>({
    email: str(e.email),
    national_id: str(e.national_id),
    tax_id: str(e.tax_id),
    hired_at: str(e.hired_at),
    department_id: str(p.department_id),
    position_id: str(p.position_id),
    manager_id: str(p.manager_id),
    contract_type: str(p.contract_type),
    sat_regime: str(p.sat_regime || '02'),
    contract_start: str(p.contract_start),
    contract_end: str(p.contract_end),
    probation_end: str(p.probation_end),
    daily_salary: str(p.daily_salary),
    birth_date: str(p.birth_date),
    nss: str(p.nss),
    address: str(p.address),
    emergency_name: str(p.emergency_name),
    emergency_phone: str(p.emergency_phone),
    beneficiaries: str(p.beneficiaries),
    vacation_days_taken_before: str(p.vacation_days_taken_before ?? 0),
  });
  const [rest, setRest] = useState<number[]>((p.rest_days as number[] | undefined) ?? [7]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });

  const warnings = [
    f.national_id && !isValidCurp(f.national_id) ? 'La CURP no parece válida.' : null,
    f.tax_id && !isValidRfc(f.tax_id) ? 'El RFC no parece válido.' : null,
    f.nss && !isValidNss(f.nss) ? 'El NSS no parece válido.' : null,
  ].filter(Boolean);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/rh/employees/${e.id}`, { method: 'PATCH', body: { ...f, rest_days: rest } });
      setMsg({ ok: true, text: 'Expediente guardado.' });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'No se pudo guardar.' });
    } finally {
      setBusy(false);
    }
  }

  const people = (structure?.people ?? []).filter((x) => x.id !== e.id);
  return (
    <form className="stack" onSubmit={save}>
      <fieldset disabled={!canEdit} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <section className="sheet stack">
          <h2>Datos laborales</h2>
          <div className="form-grid">
            <label className="field">
              Fecha de ingreso <small>para sus vacaciones</small>
              <input type="date" value={f.hired_at} onChange={set('hired_at')} />
            </label>
            <label className="field">
              Área
              <select value={f.department_id} onChange={set('department_id')}>
                <option value="">Sin área</option>
                {structure?.departments.filter((d) => d.active || d.id === f.department_id).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Puesto
              <select value={f.position_id} onChange={set('position_id')}>
                <option value="">Sin puesto</option>
                {structure?.positions.filter((x) => x.active || x.id === f.position_id).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Jefe directo
              <select value={f.manager_id} onChange={set('manager_id')}>
                <option value="">Sin jefe directo</option>
                {people.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Tipo de contrato
              <select value={f.contract_type} onChange={set('contract_type')}>
                <option value="">Sin definir</option>
                {Object.entries(CONTRACT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Régimen de contratación (SAT)
              <select value={f.sat_regime} onChange={set('sat_regime')}>
                {Object.entries(SAT_CONTRACT_REGIMES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {k} · {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Inicio de contrato
              <input type="date" value={f.contract_start} onChange={set('contract_start')} />
            </label>
            {f.contract_type && f.contract_type !== 'indeterminado' && (
              <label className="field">
                Fin de contrato
                <input type="date" value={f.contract_end} onChange={set('contract_end')} />
              </label>
            )}
            <label className="field">
              Fin del periodo de prueba <small>opcional</small>
              <input type="date" value={f.probation_end} onChange={set('probation_end')} />
            </label>
            <label className="field">
              Sueldo diario <small>opcional</small>
              <input value={f.daily_salary} onChange={set('daily_salary')} inputMode="decimal" placeholder="0.00" />
            </label>
            <label className="field">
              Vacaciones ya disfrutadas <small>antes de usar Korporia</small>
              <input value={f.vacation_days_taken_before} onChange={set('vacation_days_taken_before')} inputMode="decimal" />
            </label>
          </div>
          <div>
            <span className="muted" style={{ fontSize: '0.9rem' }}>Días de descanso semanal</span>
            <div className="chips" style={{ marginTop: 6 }}>
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="check" style={{ marginRight: 10 }}>
                  <input
                    type="checkbox"
                    checked={rest.includes(i + 1)}
                    onChange={(ev) => setRest(ev.target.checked ? [...rest, i + 1].sort() : rest.filter((x) => x !== i + 1))}
                  />
                  <span>{d}</span>
                </label>
              ))}
            </div>
          </div>
        </section>
        <section className="sheet stack">
          <h2>Datos personales</h2>
          <div className="form-grid">
            <label className="field">
              CURP
              <input value={f.national_id} onChange={(ev) => setF({ ...f, national_id: ev.target.value.toUpperCase() })} maxLength={18} />
            </label>
            <label className="field">
              RFC
              <input value={f.tax_id} onChange={(ev) => setF({ ...f, tax_id: ev.target.value.toUpperCase() })} maxLength={13} />
            </label>
            <label className="field">
              NSS
              <input value={f.nss} onChange={set('nss')} inputMode="numeric" maxLength={11} />
            </label>
            <label className="field">
              Fecha de nacimiento
              <input type="date" value={f.birth_date} onChange={set('birth_date')} />
            </label>
            <label className="field">
              Correo <small>opcional</small>
              <input type="email" value={f.email} onChange={set('email')} />
            </label>
            <label className="field">
              Domicilio
              <input value={f.address} onChange={set('address')} />
            </label>
            <label className="field">
              Contacto de emergencia
              <input value={f.emergency_name} onChange={set('emergency_name')} />
            </label>
            <label className="field">
              Teléfono de emergencia
              <input value={f.emergency_phone} onChange={set('emergency_phone')} inputMode="tel" />
            </label>
            <label className="field">
              Beneficiarios <small>nombre y porcentaje</small>
              <input value={f.beneficiaries} onChange={set('beneficiaries')} />
            </label>
          </div>
          {warnings.length > 0 && <div className="notice warn">{warnings.join(' ')}</div>}
        </section>
      </fieldset>
      {msg && <div className={`notice ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      {canEdit && (
        <button className="btn solid" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Guardando…' : 'Guardar expediente'}
        </button>
      )}
    </form>
  );
}

function Documents({ data, canEdit, onChanged }: { data: Detail; canEdit: boolean; onChanged: () => void }) {
  const base = `/api/rh/employees/${data.employee.id}/documents`;
  async function remove(d: StoredDocument) {
    if (!confirm(`¿Borrar "${d.name}"? El archivo se elimina.`)) return;
    try {
      await api(`${base}/${d.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'No se pudo borrar.');
    }
  }
  const q = data.quota;
  return (
    <div className="stack">
      {data.missing_documents.length > 0 && (
        <div className="notice warn">
          <strong>Documentos de ingreso que faltan</strong>
          {data.missing_documents.map((k) => DOCUMENT_KINDS[k]).join(', ')}. El colaborador también puede subirlos desde su portal.
        </div>
      )}
      {canEdit && (
        <section className="sheet">
          <DocumentUpload endpoint={base} kinds={Object.keys(DOCUMENT_KINDS).filter((k) => k !== 'consentimiento') as DocumentKind[]} onUploaded={onChanged} />
          <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>
            PDF o foto, hasta {sizeLabel(q.maxFileBytes)} por archivo.
            {q.limitBytes ? ` Espacio de tu plan: ${sizeLabel(q.usedBytes)} de ${sizeLabel(q.limitBytes)}.` : ''}
          </p>
        </section>
      )}
      <div className="list">
        {data.documents.length === 0 && <p className="muted">Sin documentos.</p>}
        {data.documents.map((d) => (
          <div className="row" key={d.id}>
            <div className="grow">
              <div>{DOCUMENT_KINDS[d.kind]}</div>
              <div className="sub">
                {d.name} · {sizeLabel(d.size_bytes)} · {shortDate(d.created_at)}
                {d.by_employee ? ' · lo subió el colaborador' : ''}
                {d.expires_on ? ` · vence ${shortDate(d.expires_on)}` : ''}
              </div>
            </div>
            <button className="btn small quiet" onClick={() => void openDocument(`${base}/${d.id}`)}>
              Ver
            </button>
            {canEdit && d.kind !== 'consentimiento' && (
              <button className="btn small quiet danger" onClick={() => void remove(d)}>
                Borrar
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Absences({ data, canApprove, onChanged }: { data: Detail; canApprove: boolean; onChanged: () => void }) {
  const [recording, setRecording] = useState(false);
  const b = data.balance;
  return (
    <div className="stack">
      <section className="sheet">
        {b ? (
          <>
            <p className="muted" style={{ margin: 0 }}>Vacaciones disponibles</p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700, margin: '4px 0' }}>{b.available} días</p>
            <p className="muted" style={{ margin: 0 }}>
              {b.yearsOfService} año(s) de antigüedad · ganados {b.earned} · disfrutados {b.taken}
              {b.pending ? ` · por aprobar ${b.pending}` : ''} · el {shortDate(b.nextAnniversary)} gana {b.nextYearDays} días (LFT art. 76).
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Registra la fecha de ingreso en Datos para calcular sus vacaciones de ley.</p>
        )}
      </section>
      {canApprove && (
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setRecording(true)}>
          Registrar ausencia o incapacidad
        </button>
      )}
      <LeaveList leaves={data.leaves} canApprove={canApprove} onChanged={onChanged} />
      {recording && (
        <RecordLeave
          employeeId={data.employee.id}
          documents={data.documents}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Lista de ausencias con aprobación (la usa el expediente y la bandeja de solicitudes). */
export function LeaveList({ leaves, canApprove, onChanged, showName = false }: { leaves: Leave[]; canApprove: boolean; onChanged: () => void; showName?: boolean }) {
  async function decide(l: Leave, decision: 'aprobada' | 'rechazada' | 'cancelada') {
    let note: string | null = null;
    if (decision === 'rechazada') {
      note = prompt('Motivo del rechazo (lo verá el colaborador):') ?? null;
      if (note === null) return;
    } else if (decision === 'cancelada' && !confirm('¿Cancelar esta ausencia ya aprobada?')) return;
    try {
      await api(`/api/rh/leaves/${l.id}/decision`, { body: { decision, note } });
      onChanged();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'No se pudo guardar.');
    }
  }
  if (leaves.length === 0) return <p className="muted">Sin ausencias registradas.</p>;
  return (
    <div className="list">
      {leaves.map((l) => (
        <div className="row" key={l.id} style={{ flexWrap: 'wrap' }}>
          <div className="grow">
            <div>
              {showName && l.employee ? <strong>{l.employee.full_name} · </strong> : null}
              {leaveLabel(l)}
            </div>
            <div className="sub">
              {shortDate(l.start_date)}
              {l.end_date !== l.start_date ? ` al ${shortDate(l.end_date)}` : ''}
              {l.imss_folio ? ` · folio ${l.imss_folio}` : ''}
              {l.reason ? ` · ${l.reason}` : ''}
              {l.decision_note ? ` · ${l.decision_note}` : ''}
            </div>
          </div>
          <LeaveStatusChip status={l.status} />
          {canApprove && l.status === 'pendiente' && (
            <>
              <button className="btn small solid" onClick={() => void decide(l, 'aprobada')}>
                Aprobar
              </button>
              <button className="btn small quiet" onClick={() => void decide(l, 'rechazada')}>
                Rechazar
              </button>
            </>
          )}
          {canApprove && l.status === 'aprobada' && (
            <button className="btn small quiet" onClick={() => void decide(l, 'cancelada')}>
              Cancelar
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** El administrador registra una ausencia ya aprobada (incluye incapacidades del IMSS y licencias). */
export function RecordLeave({
  employeeId,
  documents,
  employees,
  onClose,
  onSaved,
}: {
  employeeId?: string;
  documents?: StoredDocument[];
  employees?: { id: string; full_name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [who, setWho] = useState(employeeId ?? '');
  const [kind, setKind] = useState<LeaveKind>('incapacidad');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [type, setType] = useState('enfermedad_general');
  const [folio, setFolio] = useState('');
  const [doc, setDoc] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/rh/leaves', {
        body: { employee_id: who, kind, start_date: start, end_date: end, incapacity_type: type, imss_folio: folio, document_id: doc || null, reason },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar.');
      setBusy(false);
    }
  }
  return (
    <Modal title="Registrar ausencia" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {employees && (
          <label className="field">
            Colaborador
            <select value={who} onChange={(e) => setWho(e.target.value)} required>
              <option value="">Elige</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Tipo
          <select value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)}>
            {Object.entries(LEAVE_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label className="field">
            Desde
            <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} required />
          </label>
          <label className="field">
            Hasta
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>
        {kind === 'incapacidad' && (
          <div className="form-grid">
            <label className="field">
              Tipo de incapacidad
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(INCAPACITY_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Folio del IMSS
              <input value={folio} onChange={(e) => setFolio(e.target.value.toUpperCase())} maxLength={20} />
            </label>
          </div>
        )}
        {documents && documents.length > 0 && (
          <label className="field">
            Constancia <small>del expediente, opcional</small>
            <select value={doc} onChange={(e) => setDoc(e.target.value)}>
              <option value="">Sin constancia</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {DOCUMENT_KINDS[d.kind]} · {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Nota <small>opcional</small>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </label>
        {error && <div className="notice error">{error}</div>}
        <button className="btn solid block" disabled={busy || !who}>
          {busy ? 'Guardando…' : 'Registrar'}
        </button>
      </form>
    </Modal>
  );
}

/**
 * Alta guiada (ONB, sin alta al IMSS): datos básicos → datos laborales → documentos de
 * ingreso → acceso del colaborador (código de activación).
 */
function Alta({ me, structure, canEdit, onClose }: { me: Me; structure: Structure; canEdit: boolean; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [created, setCreated] = useState<{ id: string; name: string; number: string; phone: string | null } | null>(null);
  const [f, setF] = useState({ employee_number: '', full_name: '', phone: '', default_site_id: '', hired_at: '' });
  const [job, setJob] = useState({ position_id: '', department_id: '', manager_id: '', contract_type: 'indeterminado', sat_regime: '02', contract_start: '', contract_end: '', probation_end: '' });
  const [docs, setDocs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createBasic(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const position = structure.positions.find((p) => p.id === job.position_id)?.name ?? '';
      const res = await api<{ employee: { id: string } }>('/api/core/members', {
        body: { company_id: me.company!.id, employee_number: f.employee_number, full_name: f.full_name, phone: f.phone, default_site_id: f.default_site_id || null, position },
      });
      setCreated({ id: res.employee.id, name: f.full_name, number: f.employee_number, phone: f.phone || null });
      if (f.hired_at && canEdit) await api(`/api/rh/employees/${res.employee.id}`, { method: 'PATCH', body: { hired_at: f.hired_at } });
      setStep(canEdit ? 2 : 4);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo dar de alta.');
    } finally {
      setBusy(false);
    }
  }

  async function saveJob(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/rh/employees/${created!.id}`, {
        method: 'PATCH',
        body: { ...job, contract_start: job.contract_start || f.hired_at, contract_end: job.contract_type === 'indeterminado' ? '' : job.contract_end },
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  const creds: Credentials | null = created ? { employeeId: created.id, name: created.name, phone: created.phone, code: me.company!.code, number: created.number } : null;
  if (step === 4 && creds) return <CredentialCard creds={creds} onClose={onClose} />;

  return (
    <Modal title={`Alta guiada · paso ${step} de 4`} onClose={onClose} width={600}>
      {step === 1 && (
        <form className="stack" onSubmit={createBasic}>
          <div className="form-grid">
            <label className="field">
              Número de empleado
              <input value={f.employee_number} onChange={(e) => setF({ ...f, employee_number: e.target.value })} required pattern="[A-Za-z0-9-]+" />
            </label>
            <label className="field">
              Nombre completo
              <input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required />
            </label>
            <label className="field">
              Celular <small>para enviarle su acceso</small>
              <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" />
            </label>
            <label className="field">
              Fecha de ingreso
              <input type="date" value={f.hired_at} onChange={(e) => setF({ ...f, hired_at: e.target.value })} />
            </label>
            <label className="field">
              Obra o sucursal habitual
              <select value={f.default_site_id} onChange={(e) => setF({ ...f, default_site_id: e.target.value })}>
                <option value="">La más cercana al checar</option>
                {me.sites?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <div className="notice error">{error}</div>}
          <button className="btn solid block" disabled={busy}>
            {busy ? 'Guardando…' : 'Dar de alta y seguir'}
          </button>
        </form>
      )}
      {step === 2 && (
        <form className="stack" onSubmit={saveJob}>
          <div className="form-grid">
            <label className="field">
              Puesto
              <select value={job.position_id} onChange={(e) => setJob({ ...job, position_id: e.target.value })}>
                <option value="">Sin puesto</option>
                {structure.positions.filter((p) => p.active).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Área
              <select value={job.department_id} onChange={(e) => setJob({ ...job, department_id: e.target.value })}>
                <option value="">Sin área</option>
                {structure.departments.filter((d) => d.active).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Jefe directo
              <select value={job.manager_id} onChange={(e) => setJob({ ...job, manager_id: e.target.value })}>
                <option value="">Sin jefe directo</option>
                {structure.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Contrato
              <select value={job.contract_type} onChange={(e) => setJob({ ...job, contract_type: e.target.value })}>
                {Object.entries(CONTRACT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {job.contract_type !== 'indeterminado' && (
              <label className="field">
                Fin de contrato
                <input type="date" value={job.contract_end} onChange={(e) => setJob({ ...job, contract_end: e.target.value })} />
              </label>
            )}
            <label className="field">
              Fin del periodo de prueba <small>opcional</small>
              <input type="date" value={job.probation_end} onChange={(e) => setJob({ ...job, probation_end: e.target.value })} />
            </label>
          </div>
          <p className="muted" style={{ margin: 0 }}>¿Falta un puesto o un área? Créalo en la pestaña Organigrama; puedes completar esto después.</p>
          {error && <div className="notice error">{error}</div>}
          <button className="btn solid block" disabled={busy}>
            {busy ? 'Guardando…' : 'Seguir'}
          </button>
          <button className="btn quiet block" type="button" onClick={() => setStep(3)}>
            Omitir por ahora
          </button>
        </form>
      )}
      {step === 3 && created && (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            Documentos de ingreso. Puedes subirlos ahora o pedirle al colaborador que los suba desde su portal.
          </p>
          <div className="list">
            {ONBOARDING_DOCUMENTS.map((k) => (
              <div className="row" key={k}>
                <div className="grow">{DOCUMENT_KINDS[k]}</div>
                {docs.has(k) ? (
                  <span className="chip go">Cargado</span>
                ) : (
                  <DocumentUpload compact endpoint={`/api/rh/employees/${created.id}/documents`} kinds={[k]} defaultKind={k} onUploaded={() => setDocs(new Set([...docs, k]))} />
                )}
              </div>
            ))}
          </div>
          <button className="btn solid block" onClick={() => setStep(4)}>
            Seguir: enviar su acceso
          </button>
        </div>
      )}
    </Modal>
  );
}
