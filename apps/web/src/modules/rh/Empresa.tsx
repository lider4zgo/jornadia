import { useEffect, useState, type FormEvent } from 'react';
import { PLAN_LABELS } from '@korporia/core';
import { api, ApiError } from '../../lib/api';
import { can, writable } from '../../lib/access';
import { formatDate } from '../../lib/clock';
import type { Me } from '../../types';

interface Profile {
  legal_name: string | null;
  address: string | null;
  privacy_email: string | null;
  privacy_phone: string | null;
}

/** Datos del patrón para el aviso de privacidad de sus trabajadores, y el plan contratado. */
export function Empresa({ me }: { me: Me }) {
  const company = me.company!;
  const sub = company.subscription;
  const canEdit = can(me, 'core.empresa.editar') && writable(me, 'core');
  const [f, setF] = useState<Profile | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ company: Profile }>(`/api/core/companies/${company.id}/profile`)
      .then((r) => setF(r.company))
      .catch(() => setMsg({ ok: false, text: 'No se pudieron cargar los datos.' }));
  }, [company.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/core/companies/${company.id}/profile`, { method: 'PATCH', body: { ...f } });
      setMsg({ ok: true, text: 'Guardado. Los trabajadores verán estos datos en su aviso de privacidad.' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'No se pudo guardar.' });
    } finally {
      setBusy(false);
    }
  }

  const missing = f && (!f.address || (!f.privacy_email && !f.privacy_phone));
  return (
    <div className="stack">
      <h1>Empresa</h1>
      {sub && (
        <section className="sheet">
          <h2>Plan</h2>
          <p style={{ margin: 0 }}>
            <strong>{PLAN_LABELS[sub.plan] ?? sub.plan}</strong> · hasta {sub.employee_limit} colaboradores
            {sub.admin_limit ? ` · ${sub.admin_limit} administrador${sub.admin_limit === 1 ? '' : 'es'}` : ''}
          </p>
          {sub.plan === 'starter' && sub.starter_clock_until && (
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Checador hasta el {formatDate(sub.starter_clock_until, company.timezone)}
              {sub.starter_hr_until ? `; RH básico hasta el ${formatDate(sub.starter_hr_until, company.timezone)}` : ''}. Código de empresa:{' '}
              <strong>{company.code}</strong>
            </p>
          )}
        </section>
      )}
      <form className="sheet stack" onSubmit={save}>
        <h2>Datos para el aviso de privacidad de tus trabajadores</h2>
        <p className="muted" style={{ margin: 0 }}>
          Tu empresa es la responsable de los datos de sus trabajadores y Korporia su encargado. Estos datos aparecen en el aviso que cada
          trabajador firma en su app.
        </p>
        {missing && <div className="notice warn">Completa el domicilio y un correo o teléfono para temas de privacidad.</div>}
        {f && (
          <fieldset disabled={!canEdit} className="form-grid" style={{ border: 0, padding: 0, margin: 0 }}>
            <label className="field">
              Razón social o nombre del patrón
              <input value={f.legal_name ?? ''} onChange={(e) => setF({ ...f, legal_name: e.target.value })} placeholder={company.name} />
            </label>
            <label className="field">
              Domicilio
              <input value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} />
            </label>
            <label className="field">
              Correo para privacidad
              <input type="email" value={f.privacy_email ?? ''} onChange={(e) => setF({ ...f, privacy_email: e.target.value })} />
            </label>
            <label className="field">
              Teléfono para privacidad
              <input value={f.privacy_phone ?? ''} onChange={(e) => setF({ ...f, privacy_phone: e.target.value })} inputMode="tel" />
            </label>
          </fieldset>
        )}
        {msg && <div className={`notice ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
        {canEdit && (
          <button className="btn solid" disabled={busy || !f} style={{ alignSelf: 'flex-start' }}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </form>
    </div>
  );
}
