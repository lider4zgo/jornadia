import { useEffect, useState, type FormEvent } from 'react';
import { ADMIN_POSITIONS } from '@korporia/core';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { saveDeviceToken } from '../lib/trust';
import { Modal, SuggestSelect } from '../common';
import type { Me } from '../types';
import { CreatePassword } from './DeviceGate';

interface Profile {
  first_names: string | null;
  last_name_paternal: string | null;
  last_name_maternal: string | null;
  birth_date: string | null;
  mobile: string | null;
  position_title: string | null;
}

const EMPTY: Profile = { first_names: '', last_name_paternal: '', last_name_maternal: '', birth_date: '', mobile: '', position_title: '' };

/** Mi perfil (administradores): datos personales, puesto y contraseña. */
export function MyProfile({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [f, setF] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    api<{ email: string; profile: Profile | null }>('/api/core/profile')
      .then((r) => {
        setEmail(r.email ?? '');
        setF({ ...EMPTY, ...Object.fromEntries(Object.entries(r.profile ?? {}).map(([k, v]) => [k, v ?? ''])) } as Profile);
      })
      .catch(() => setMsg({ ok: false, text: 'No se pudo cargar tu perfil.' }));
    if (me.company) {
      api<{ company: { custom_positions?: string[] } }>(`/api/core/companies/${me.company.id}/profile`)
        .then((r) => setPositions(r.company.custom_positions ?? []))
        .catch(() => setPositions([]));
    }
  }, [me.company]);

  const set = (k: keyof Profile) => (e: { target: { value: string } }) => f && setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/core/profile', { method: 'PATCH', body: { ...f } });
      setMsg({ ok: true, text: 'Tu perfil quedó guardado.' });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'No se pudo guardar.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content stack" style={{ paddingBottom: 48 }}>
      <h1>Mi perfil</h1>
      <form className="sheet stack" onSubmit={save}>
        <p className="muted" style={{ margin: 0 }}>
          Correo de acceso: <strong>{email}</strong>
        </p>
        {f && (
          <div className="form-grid">
            <label className="field">
              Nombre(s)
              <input value={f.first_names ?? ''} onChange={set('first_names')} autoComplete="given-name" />
            </label>
            <label className="field">
              Apellido paterno
              <input value={f.last_name_paternal ?? ''} onChange={set('last_name_paternal')} autoComplete="family-name" />
            </label>
            <label className="field">
              Apellido materno
              <input value={f.last_name_maternal ?? ''} onChange={set('last_name_maternal')} />
            </label>
            <label className="field">
              Fecha de nacimiento
              <input type="date" value={f.birth_date ?? ''} onChange={set('birth_date')} max={new Date().toISOString().slice(0, 10)} autoComplete="bday" />
            </label>
            <label className="field">
              Celular
              <input value={f.mobile ?? ''} onChange={set('mobile')} inputMode="tel" autoComplete="tel" />
            </label>
            <label className="field">
              Puesto en la empresa
              <SuggestSelect
                value={f.position_title ?? ''}
                options={[...ADMIN_POSITIONS, ...positions]}
                onChange={(v) => setF({ ...f, position_title: v })}
                otherLabel="Agregar otro puesto"
              />
            </label>
          </div>
        )}
        {msg && <div className={`notice ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn solid" disabled={busy || !f}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="btn" onClick={() => setChangingPassword(true)}>
            Cambiar contraseña
          </button>
          {me.company && (
            <button type="button" className="btn quiet" onClick={() => navigate('/rh/empresa')}>
              Perfil de la empresa
            </button>
          )}
        </div>
      </form>
      {changingPassword && (
        <Modal title="Cambiar contraseña" onClose={() => setChangingPassword(false)}>
          <CreatePassword
            framed={false}
            title="Cambiar contraseña"
            intro="Te pediremos un código de tu correo para confirmar el cambio. Los demás dispositivos tendrán que volver a confirmar."
            onSaved={(token) => {
              saveDeviceToken(me.userId, token);
              setChangingPassword(false);
              setMsg({ ok: true, text: 'Tu contraseña cambió.' });
            }}
            onCancel={() => setChangingPassword(false)}
          />
        </Modal>
      )}
    </div>
  );
}
