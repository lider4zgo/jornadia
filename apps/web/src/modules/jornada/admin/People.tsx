import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import { can } from '../../../lib/access';
import type { Me } from '../../../types';
import { EnrollFace } from './EnrollFace';

interface EmployeeRow {
  id: string;
  employee_number: string;
  full_name: string;
  position: string | null;
  phone: string | null;
  active: boolean;
  consent_confirmed_at: string | null;
  default_site_id: string | null;
  face_enrolled_at: string | null;
}

interface Credentials {
  name: string;
  phone: string | null;
  code: string;
  number: string;
}

/** Alta de colaboradores y foto de registro en persona. El supervisor solo puede tomar fotos. */
export function People({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const company = me.company!;
  const isManager = can(me, 'core.personal.gestionar');
  const canEnroll = can(me, 'jornada.rostros.registrar');
  const canResetFace = can(me, 'jornada.rostros.restablecer');
  const canConfigure = can(me, 'jornada.configurar');
  const employeeLimit = company.subscription?.employee_limit ?? 0;
  const [enrolling, setEnrolling] = useState<EmployeeRow | null>(null);
  const [trackBreaks, setTrackBreaks] = useState(me.jornada?.settings?.track_breaks ?? false);

  async function toggleBreaks(value: boolean) {
    setTrackBreaks(value);
    const { data, error: err } = await supabase
      .schema('jornada')
      .from('settings')
      .update({ track_breaks: value })
      .eq('company_id', company.id)
      .select('company_id');
    if (err || !data?.length) {
      setTrackBreaks(!value);
      setError('No tienes permiso para cambiar esta opción.');
    } else onChanged();
  }
  const [list, setList] = useState<EmployeeRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Expediente (core) + datos de asistencia del colaborador (jornada)
    const [employees, settings] = await Promise.all([
      supabase
        .schema('core')
        .from('employees')
        .select('id, employee_number, full_name, position, phone, active, default_site_id')
        .eq('company_id', company.id)
        .order('employee_number'),
      supabase.schema('jornada').from('employee_settings').select('employee_id, consent_confirmed_at, face_enrolled_at').eq('company_id', company.id),
    ]);
    if (employees.error || settings.error) setError('No se pudo cargar el personal.');
    const byEmployee = new Map((settings.data ?? []).map((r) => [r.employee_id as string, r]));
    setList(
      (employees.data ?? []).map((e) => ({
        ...(e as Omit<EmployeeRow, 'consent_confirmed_at' | 'face_enrolled_at'>),
        consent_confirmed_at: byEmployee.get(e.id)?.consent_confirmed_at ?? null,
        face_enrolled_at: byEmployee.get(e.id)?.face_enrolled_at ?? null,
      })),
    );
  }, [company.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resetFace(e: EmployeeRow) {
    if (!confirm(`¿Borrar la foto de registro de ${e.full_name}? No podrá checar hasta que un supervisor le tome una nueva.`)) return;
    try {
      await api(`/api/jornada/employees/${e.id}/face`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo borrar la foto.');
    }
  }

  const active = list?.filter((e) => e.active).length ?? 0;

  return (
    <div className="content">
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <h1>Personal</h1>
          <p className="muted">
            {active} de {employeeLimit} colaboradores activos en tu plan. Código de empresa para entrar: <strong>{company.code}</strong>
          </p>
        </div>
        {isManager && (
          <button className="btn solid" onClick={() => setShowForm(true)} disabled={active >= employeeLimit}>
            Agregar colaborador
          </button>
        )}
      </div>

      {canConfigure && (
      <label className="check">
        <input type="checkbox" checked={trackBreaks} onChange={(e) => void toggleBreaks(e.target.checked)} />
        <span>
          Registrar hora de comida
          <span className="muted" style={{ display: 'block', fontSize: '0.9rem' }}>
            Opcional. Si está activo, los colaboradores verán los botones de inicio y fin de comida y ese tiempo se descuenta de la jornada.
          </span>
        </span>
      </label>
      )}

      {error && <div className="notice error">{error}</div>}
      {creds && <CredentialCard creds={creds} onClose={() => setCreds(null)} />}
      {enrolling && (
        <EnrollFace
          employee={enrolling}
          onClose={() => setEnrolling(null)}
          onEnrolled={() => {
            setEnrolling(null);
            void load();
          }}
        />
      )}
      {showForm && (
        <NewEmployee
          me={me}
          onClose={() => setShowForm(false)}
          onCreated={(c) => {
            setShowForm(false);
            setCreds(c);
            void load();
          }}
        />
      )}

      {!list ? (
        <p className="muted">Cargando…</p>
      ) : list.length === 0 ? (
        <p className="muted">Aún no hay colaboradores. Agrega el primero para que pueda checar.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Núm.</th>
                <th>Nombre</th>
                <th>Obra habitual</th>
                <th>Foto de registro</th>
                <th>Consentimiento</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} style={{ opacity: e.active ? 1 : 0.55 }}>
                  <td>{e.employee_number}</td>
                  <td>
                    {e.full_name}
                    {e.position && <div className="muted" style={{ fontSize: '0.85rem' }}>{e.position}</div>}
                  </td>
                  <td>{me.sites?.find((s) => s.id === e.default_site_id)?.name ?? 'La más cercana'}</td>
                  <td>{e.face_enrolled_at ? <span className="chip go">Registrada</span> : <span className="chip warn">Pendiente</span>}</td>
                  <td>{e.consent_confirmed_at ? <span className="chip go">Confirmado</span> : <span className="chip stop">Falta</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!e.face_enrolled_at && e.active && canEnroll && (
                      <button className="btn small" onClick={() => setEnrolling(e)}>
                        Tomar foto
                      </button>
                    )}
                    {e.face_enrolled_at && canResetFace && (
                      <button className="btn small quiet" onClick={() => void resetFace(e)}>
                        Repetir foto
                      </button>
                    )}
                    {isManager && (
                      <button
                        className="btn small quiet"
                        onClick={() => setCreds({ name: e.full_name, phone: e.phone, code: company.code, number: e.employee_number })}
                      >
                        Enviar acceso
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewEmployee({ me, onClose, onCreated }: { me: Me; onClose: () => void; onCreated: (c: Credentials) => void }) {
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [phone, setPhone] = useState('');
  const [site, setSite] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/core/members', {
        body: {
          company_id: me.company!.id,
          employee_number: number,
          full_name: name,
          position,
          phone,
          default_site_id: site || null,
          consent_confirmed: consent,
        },
      });
      onCreated({ name, phone: phone || null, code: me.company!.code, number });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo dar de alta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sheet" onSubmit={submit}>
      <h2>Nuevo colaborador</h2>
      <div className="form-grid">
        <label className="field">
          Número de empleado
          <input value={number} onChange={(e) => setNumber(e.target.value)} required pattern="[A-Za-z0-9-]+" />
        </label>
        <label className="field">
          Nombre completo
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          Puesto <small>opcional</small>
          <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Ej. Oficial electricista" />
        </label>
        <label className="field">
          Celular <small>para enviarle su acceso por WhatsApp</small>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="871 123 4567" />
        </label>
        <label className="field">
          Obra habitual
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">La más cercana al checar</option>
            {me.sites?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          Confirmo que la empresa cuenta con el consentimiento por escrito de este colaborador para usar su foto y ubicación al registrar
          su jornada.
        </span>
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="toolbar">
        <button className="btn solid" type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Dar de alta'}
        </button>
        <button className="btn quiet" type="button" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function CredentialCard({ creds, onClose }: { creds: Credentials; onClose: () => void }) {
  const url = window.location.origin;
  const message =
    `Hola ${creds.name.split(' ')[0]}, este es tu acceso a Korporia para checar tu entrada y salida:\n` +
    `${url}\n\nCódigo de empresa: ${creds.code}\nNúmero de empleado: ${creds.number}\n\n` +
    `Ábrelo en Chrome y elige "Agregar a pantalla principal" para tenerlo como app.`;
  const phone = creds.phone?.replace(/\D/g, '');
  const wa = phone ? `https://wa.me/${phone.length === 10 ? `52${phone}` : phone}?text=${encodeURIComponent(message)}` : null;

  return (
    <div className="notice ok" role="status">
      <strong>Acceso de {creds.name}</strong>
      <p style={{ color: 'var(--ink)', margin: '6px 0 10px' }}>
        Código de empresa <b>{creds.code}</b> y número <b>{creds.number}</b>. Antes de su primera checada, tómale la foto de registro con
        el botón Tomar foto.
      </p>
      <div className="toolbar">
        {wa && (
          <a className="btn small solid" href={wa} target="_blank" rel="noreferrer">
            Enviar por WhatsApp
          </a>
        )}
        <button className="btn small" onClick={() => void navigator.clipboard?.writeText(message)}>
          Copiar mensaje
        </button>
        <button className="btn small quiet" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
