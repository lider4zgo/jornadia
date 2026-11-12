import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

/** Mensaje claro para los errores de Supabase al pedir o validar un código. */
export function otpErrorMessage(message: string): string {
  if (/signups? not allowed|user not found/i.test(message)) return 'NO_ACCOUNT';
  if (/seconds|rate|too many/i.test(message)) return 'Ya te enviamos un código hace poco. Espera un minuto antes de pedir otro.';
  if (/expired|invalid|token/i.test(message)) return 'El código no es correcto o ya venció. Revísalo o pide uno nuevo.';
  if (/fetch|network/i.test(message)) return 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.';
  return `No se pudo continuar: ${message}`;
}

/** Pide a Supabase un código de un solo uso para una cuenta que ya existe. */
export async function sendCode(email: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  return error ? otpErrorMessage(error.message) : null;
}

/**
 * Segundo paso del acceso sin contraseña: la persona escribe el código que recibió.
 * Al validarlo, Supabase inicia la sesión y la app se actualiza sola.
 */
export function EmailCode({ email, onBack, busyLabel = 'Entrando…' }: { email: string; onBack: () => void; busyLabel?: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(60);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token: code.replace(/\s/g, ''), type: 'email' });
    if (err) {
      setError(otpErrorMessage(err.message));
      setBusy(false);
    }
    // Con éxito, onAuthStateChange abre la app; este componente se desmonta
  }

  async function resend() {
    setError(null);
    setInfo(null);
    const msg = await sendCode(email);
    if (msg) setError(msg === 'NO_ACCOUNT' ? 'No encontramos una cuenta con ese correo.' : msg);
    else {
      setInfo('Te enviamos un código nuevo.');
      setWait(60);
    }
  }

  return (
    <form className="stack" onSubmit={verify} noValidate>
      <div className="notice ok" role="status">
        <strong>Revisa tu correo</strong>
        Te enviamos un código de acceso a <b>{email}</b>. Si no lo ves en unos minutos, busca en la carpeta de spam o de promociones.
      </div>
      <label className="field">
        Código
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          required
          autoFocus
          style={{ letterSpacing: '0.3em', fontSize: '1.4rem', textAlign: 'center' }}
        />
      </label>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {info && <div className="notice ok">{info}</div>}
      <button className="btn solid block" type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>
        {busy ? busyLabel : 'Continuar'}
      </button>
      <button type="button" className="btn quiet block" onClick={() => void resend()} disabled={wait > 0}>
        {wait > 0 ? `Reenviar código en ${wait} s` : 'Reenviar código'}
      </button>
      <button type="button" className="btn quiet block" onClick={onBack}>
        Usar otro correo
      </button>
    </form>
  );
}
