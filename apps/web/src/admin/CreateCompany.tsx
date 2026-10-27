import { useState, type FormEvent } from 'react';
import { normalizeCompanyCode } from '@jornadia/core';
import { api, ApiError } from '../lib/api';

/** Superadmin: da de alta una empresa cliente y su usuario propietario. */
export function CreateCompany({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [limit, setLimit] = useState('100');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/companies', {
        body: {
          name,
          code: normalizeCompanyCode(code),
          owner_name: ownerName,
          owner_email: ownerEmail,
          owner_password: ownerPassword,
          employee_limit: Number(limit),
          trial_days: Number(days),
        },
      });
      setDone(`${name} quedó creada. El propietario entra con ${ownerEmail} en la pestaña Administración.`);
      setName('');
      setCode('');
      setOwnerName('');
      setOwnerEmail('');
      setOwnerPassword('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la empresa.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content">
      <h1>Nueva empresa cliente</h1>
      <p className="muted">Solo tú ves esta pantalla. Crea la empresa del piloto y entrega el acceso al dueño.</p>
      {done && <div className="notice ok">{done}</div>}
      <form className="sheet" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            Nombre comercial
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            Código de empresa <small>3 a 16 letras o números; los trabajadores lo escriben al entrar</small>
            <input value={code} onChange={(e) => setCode(normalizeCompanyCode(e.target.value))} required minLength={3} maxLength={16} />
          </label>
          <label className="field">
            Nombre del propietario
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
          </label>
          <label className="field">
            Correo del propietario
            <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required />
          </label>
          <label className="field">
            Contraseña inicial <small>mínimo 8 caracteres</small>
            <input value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} required minLength={8} />
          </label>
          <label className="field">
            Límite de trabajadores
            <input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
          </label>
          <label className="field">
            Días de prueba
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        </div>
        {error && <div className="notice error">{error}</div>}
        <button className="btn solid" type="submit" disabled={busy}>
          {busy ? 'Creando…' : 'Crear empresa'}
        </button>
      </form>
    </div>
  );
}
