import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';

interface Referral {
  code: string;
  kind: 'despacho' | 'campana';
  name: string;
  contact_email: string | null;
  link: string;
  signups: number;
  waitlist: number;
}

/** Plataforma: enlaces con código para despachos contables y campañas, con sus registros. */
export function PlatformReferrals() {
  const [data, setData] = useState<{ codes: Referral[]; others: { origin: string; signups: number; waitlist: number }[] } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'despacho' | 'campana'>('despacho');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api('/api/core/referrals'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los enlaces.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/core/referrals', { body: { name, contact_email: email, code: code || undefined, kind } });
      setName('');
      setEmail('');
      setCode('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el enlace.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(link);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('No se pudo copiar; selecciona el enlace y cópialo a mano.');
    }
  }

  return (
    <div className="content">
      <h1>Enlaces de despachos y campañas</h1>
      <p className="muted">
        Cada enlace lleva a korporia.com con <code>?origen=</code>. El código se guarda en los registros de Korporia Starter y en la lista
        de espera.
      </p>
      {error && <div className="notice error">{error}</div>}
      <form className="sheet form-grid" onSubmit={create}>
        <label className="field">
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Despacho Pérez y Asociados" required />
        </label>
        <label className="field">
          Tipo
          <select value={kind} onChange={(e) => setKind(e.target.value as 'despacho' | 'campana')}>
            <option value="despacho">Despacho contable</option>
            <option value="campana">Campaña o material</option>
          </select>
        </label>
        <label className="field">
          Correo de contacto (opcional)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Código (opcional)
          <input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="se arma con el nombre" maxLength={40} />
        </label>
        <button className="btn solid" disabled={busy} style={{ alignSelf: 'end' }}>
          {busy ? 'Creando…' : 'Crear enlace'}
        </button>
      </form>
      {!data ? (
        <p className="muted">Cargando…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Enlace</th>
                <th className="num">Registros</th>
                <th className="num">Lista de espera</th>
              </tr>
            </thead>
            <tbody>
              {data.codes.map((r) => (
                <tr key={r.code}>
                  <td>
                    {r.name}
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {r.kind === 'despacho' ? 'Despacho' : 'Campaña'}
                      {r.contact_email ? ` · ${r.contact_email}` : ''}
                    </div>
                  </td>
                  <td>
                    <code style={{ wordBreak: 'break-all' }}>{r.link}</code>{' '}
                    <button className="btn quiet small" onClick={() => void copy(r.link)}>
                      {copied === r.link ? 'Copiado' : 'Copiar'}
                    </button>
                  </td>
                  <td className="num">{r.signups || '—'}</td>
                  <td className="num">{r.waitlist || '—'}</td>
                </tr>
              ))}
              {data.others.map((o) => (
                <tr key={o.origin}>
                  <td className="muted">Sin alta como código</td>
                  <td>
                    <code>{o.origin}</code>
                  </td>
                  <td className="num">{o.signups || '—'}</td>
                  <td className="num">{o.waitlist || '—'}</td>
                </tr>
              ))}
              {!data.codes.length && !data.others.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    Todavía no hay enlaces.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
