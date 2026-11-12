import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CONTRACT_TYPES, DOCUMENT_KINDS, LEAVE_KINDS, leaveDays, ONBOARDING_DOCUMENTS, type DocumentKind } from '@korporia/core';
import { api, ApiError } from '../../lib/api';
import { can, writable } from '../../lib/access';
import { navigate } from '../../lib/router';
import type { Me } from '../../types';
import { DocumentUpload, LeaveStatusChip, leaveLabel, openDocument, shortDate, type Balance, type Leave, type StoredDocument } from './shared';

interface PortalData {
  employee: { full_name: string; employee_number: string; phone: string | null; email: string | null; national_id: string | null; tax_id: string | null; hired_at: string | null };
  profile: {
    contract_type: keyof typeof CONTRACT_TYPES | null;
    contract_start: string | null;
    contract_end: string | null;
    nss: string | null;
    address: string | null;
    emergency_name: string | null;
    emergency_phone: string | null;
    rest_days: number[];
  } | null;
  org: { department?: string | null; position?: string | null; manager?: string | null };
  documents: StoredDocument[];
  missing_documents: DocumentKind[];
  leaves: Leave[];
  balance: Balance | null;
  today: string;
}

type Tab = 'vacaciones' | 'documentos' | 'datos';
const SELF_UPLOAD: DocumentKind[] = [...ONBOARDING_DOCUMENTS, 'estudios', 'incapacidad', 'licencia', 'certificacion'];

/** Portal del empleado: vacaciones y permisos, mis documentos y mis datos. */
export function Portal({ me, section }: { me: Me; section: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRequest = can(me, 'rh.portal.solicitar') && writable(me, 'rh');
  const tab: Tab = section === 'documentos' || section === 'datos' ? section : 'vacaciones';

  const load = useCallback(() => {
    api<PortalData>('/api/rh/me')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar tu información. Revisa tu conexión.'));
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <div className="content stack">
        {error && <div className="notice error">{error}</div>}
        {!data && !error && <p className="muted">Cargando…</p>}
        {data && tab === 'vacaciones' && <Vacations data={data} canRequest={canRequest} onChanged={load} />}
        {data && tab === 'documentos' && <MyDocuments data={data} canUpload={canRequest} onChanged={load} />}
        {data && tab === 'datos' && <MyData data={data} canEdit={canRequest} onChanged={load} />}
      </div>
      <nav className="tabbar" aria-label="Mi portal">
        <button aria-current={tab === 'vacaciones' ? 'page' : undefined} onClick={() => navigate('/rh')}>
          Vacaciones
        </button>
        <button aria-current={tab === 'documentos' ? 'page' : undefined} onClick={() => navigate('/rh/documentos')}>
          Documentos
        </button>
        <button aria-current={tab === 'datos' ? 'page' : undefined} onClick={() => navigate('/rh/datos')}>
          Mis datos
        </button>
      </nav>
    </>
  );
}

function Vacations({ data, canRequest, onChanged }: { data: PortalData; canRequest: boolean; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const pending = data.leaves.filter((l) => l.status === 'pendiente');
  async function cancel(l: Leave) {
    if (!confirm('¿Cancelar esta solicitud?')) return;
    try {
      await api(`/api/rh/me/leaves/${l.id}/cancel`, { method: 'POST' });
      onChanged();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'No se pudo cancelar.');
    }
  }
  return (
    <>
      <h1>Vacaciones y permisos</h1>
      <section className="sheet">
        {data.balance ? (
          <>
            <p className="muted" style={{ margin: 0 }}>Días de vacaciones disponibles</p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '2.4rem', fontWeight: 700, lineHeight: 1.1, margin: '4px 0' }}>{data.balance.available}</p>
            <p className="muted" style={{ margin: 0 }}>
              {data.balance.yearsOfService} año{data.balance.yearsOfService === 1 ? '' : 's'} de antigüedad · ganados {data.balance.earned}, disfrutados{' '}
              {data.balance.taken}
              {data.balance.pending ? `, por aprobar ${data.balance.pending}` : ''}. El {shortDate(data.balance.nextAnniversary)} ganas{' '}
              {data.balance.nextYearDays} días más.
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Tu empresa todavía no registra tu fecha de ingreso, así que no podemos calcular tus vacaciones.</p>
        )}
      </section>
      {canRequest && !asking && (
        <button className="btn solid block" onClick={() => setAsking(true)}>
          Pedir vacaciones o permiso
        </button>
      )}
      {asking && <RequestForm data={data} onClose={() => setAsking(false)} onSent={() => { setAsking(false); onChanged(); }} />}
      {pending.length > 0 && <div className="notice">Tienes {pending.length} solicitud{pending.length === 1 ? '' : 'es'} esperando aprobación.</div>}
      <div className="list">
        {data.leaves.length === 0 && <p className="muted">Aún no tienes solicitudes.</p>}
        {data.leaves.map((l) => (
          <div className="row" key={l.id}>
            <div className="grow">
              <div>{leaveLabel(l)}</div>
              <div className="sub">
                {shortDate(l.start_date)}
                {l.end_date !== l.start_date ? ` al ${shortDate(l.end_date)}` : ''}
                {l.decision_note ? ` · ${l.decision_note}` : ''}
              </div>
            </div>
            <LeaveStatusChip status={l.status} />
            {l.status === 'pendiente' && canRequest && (
              <button className="btn small quiet" onClick={() => void cancel(l)}>
                Cancelar
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function RequestForm({ data, onClose, onSent }: { data: PortalData; onClose: () => void; onSent: () => void }) {
  const [kind, setKind] = useState<'vacaciones' | 'permiso_con_goce' | 'permiso_sin_goce'>('vacaciones');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = start && end && end >= start ? leaveDays(kind, start, end, data.profile?.rest_days ?? [7]) : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/rh/me/leaves', { body: { kind, start_date: start, end_date: end, reason } });
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo enviar.');
      setBusy(false);
    }
  }
  return (
    <form className="sheet stack" onSubmit={submit}>
      <h2>Nueva solicitud</h2>
      <label className="field">
        ¿Qué necesitas?
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="vacaciones">{LEAVE_KINDS.vacaciones.label}</option>
          <option value="permiso_con_goce">{LEAVE_KINDS.permiso_con_goce.label}</option>
          <option value="permiso_sin_goce">{LEAVE_KINDS.permiso_sin_goce.label}</option>
        </select>
      </label>
      <div className="form-grid">
        <label className="field">
          Desde
          <input type="date" value={start} min={data.today} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} required />
        </label>
        <label className="field">
          Hasta
          <input type="date" value={end} min={start || data.today} onChange={(e) => setEnd(e.target.value)} required />
        </label>
      </div>
      {days > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {days} día{days === 1 ? '' : 's'} laborable{days === 1 ? '' : 's'} (sin contar tus descansos ni días festivos)
          {kind === 'vacaciones' && data.balance ? `; te quedarían ${Math.max(0, data.balance.available - days)}.` : '.'}
        </p>
      )}
      <label className="field">
        Comentario <small>opcional</small>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </label>
      {error && <div className="notice error">{error}</div>}
      <button className="btn solid block" type="submit" disabled={busy || days <= 0}>
        {busy ? 'Enviando…' : 'Enviar solicitud'}
      </button>
      <button className="btn quiet block" type="button" onClick={onClose}>
        Cancelar
      </button>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>¿Tienes una incapacidad del IMSS? Entrega o sube la constancia en Documentos y avisa a tu empresa.</p>
    </form>
  );
}

function MyDocuments({ data, canUpload, onChanged }: { data: PortalData; canUpload: boolean; onChanged: () => void }) {
  return (
    <>
      <h1>Mis documentos</h1>
      {data.missing_documents.length > 0 && (
        <div className="notice warn">
          <strong>Te faltan documentos de ingreso</strong>
          {data.missing_documents.map((k) => DOCUMENT_KINDS[k]).join(', ')}.
        </div>
      )}
      {canUpload && (
        <section className="sheet">
          <DocumentUpload endpoint="/api/rh/me/documents" kinds={SELF_UPLOAD} defaultKind={undefined} onUploaded={onChanged} />
        </section>
      )}
      <div className="list">
        {data.documents.length === 0 && <p className="muted">Aún no hay documentos en tu expediente.</p>}
        {data.documents.map((d) => (
          <div className="row" key={d.id}>
            <div className="grow">
              <div>{DOCUMENT_KINDS[d.kind]}</div>
              <div className="sub">
                {d.name} · {shortDate(d.created_at)}
                {d.expires_on ? ` · vence ${shortDate(d.expires_on)}` : ''}
              </div>
            </div>
            <button className="btn small quiet" onClick={() => void openDocument(`/api/rh/me/documents/${d.id}`)}>
              Ver
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function MyData({ data, canEdit, onChanged }: { data: PortalData; canEdit: boolean; onChanged: () => void }) {
  const [address, setAddress] = useState(data.profile?.address ?? '');
  const [ename, setEname] = useState(data.profile?.emergency_name ?? '');
  const [ephone, setEphone] = useState(data.profile?.emergency_phone ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/rh/me', { method: 'PATCH', body: { address, emergency_name: ename, emergency_phone: ephone } });
      setMsg('Guardado.');
      onChanged();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }
  const e = data.employee;
  const rows: [string, string | null | undefined][] = [
    ['Número de empleado', e.employee_number],
    ['Puesto', data.org.position],
    ['Área', data.org.department],
    ['Jefe directo', data.org.manager],
    ['Fecha de ingreso', e.hired_at ? shortDate(e.hired_at) : null],
    ['Contrato', data.profile?.contract_type ? CONTRACT_TYPES[data.profile.contract_type] : null],
    ['CURP', e.national_id],
    ['RFC', e.tax_id],
    ['NSS', data.profile?.nss],
    ['Celular', e.phone],
  ];
  return (
    <>
      <h1>{e.full_name}</h1>
      <div className="list">
        {rows.map(([k, v]) => (
          <div className="row" key={k}>
            <div className="grow">
              <div className="sub">{k}</div>
              <div>{v || '—'}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="muted">Si algún dato está mal, pide a Recursos Humanos que lo corrija.</p>
      <form className="sheet stack" onSubmit={save}>
        <h2>Domicilio y contacto de emergencia</h2>
        <label className="field">
          Domicilio
          <input value={address} onChange={(ev) => setAddress(ev.target.value)} disabled={!canEdit} />
        </label>
        <div className="form-grid">
          <label className="field">
            Contacto de emergencia
            <input value={ename} onChange={(ev) => setEname(ev.target.value)} disabled={!canEdit} />
          </label>
          <label className="field">
            Su teléfono
            <input value={ephone} onChange={(ev) => setEphone(ev.target.value)} inputMode="tel" disabled={!canEdit} />
          </label>
        </div>
        {msg && <div className="notice">{msg}</div>}
        {canEdit && (
          <button className="btn solid block" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </form>
    </>
  );
}
