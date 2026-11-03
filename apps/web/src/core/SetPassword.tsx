import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Mark } from '../common';

/** Se muestra al abrir el enlace de "restablecer contraseña" del correo. */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(
        /expired|invalid|session/i.test(err.message)
          ? 'El enlace ya venció. Pide uno nuevo desde "¿Olvidaste tu contraseña?".'
          : 'No se pudo guardar la contraseña. Usa al menos 8 caracteres e intenta de nuevo.',
      );
    } else {
      // Limpia el enlace de la barra de direcciones
      window.history.replaceState(null, '', window.location.pathname);
      onDone();
    }
  }

  return (
    <div className="shell">
      <form className="content" style={{ paddingTop: 32 }} onSubmit={submit} noValidate>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Mark className="mark" />
          <h1>Nueva contraseña</h1>
        </div>
        <p className="muted">Escribe tu nueva contraseña. Úsala la próxima vez que entres en la pestaña Administración.</p>
        <label className="field">
          Nueva contraseña
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
          <small>{tooShort ? 'Debe tener al menos 8 caracteres.' : 'Mínimo 8 caracteres.'}</small>
        </label>
        <label className="field">
          Repite la contraseña
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          {mismatch && <small style={{ color: 'var(--stop)' }}>Las contraseñas no coinciden.</small>}
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="btn solid block" type="submit" disabled={busy || password.length < 8 || confirm !== password}>
          {busy ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </div>
  );
}
