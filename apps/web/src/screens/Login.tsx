import { useState, type FormEvent } from 'react';
import { api, ApiError, NetworkError } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Mark, WhatsAppLink } from '../common';

const CODE_KEY = 'jornadia-company-code';

export function Login() {
  const [mode, setMode] = useState<'worker' | 'staff'>(() => (localStorage.getItem('jornadia-login-mode') === 'staff' ? 'staff' : 'worker'));
  const [code, setCode] = useState(localStorage.getItem(CODE_KEY) ?? '');
  const [number, setNumber] = useState('');
  const [match, setMatch] = useState<{ company: string; name: string; ready: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function sendReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    if (err && !/rate|seconds/i.test(err.message)) setError('No se pudo enviar el correo. Revisa la dirección e intenta de nuevo.');
    else if (err) setError('Ya enviamos un correo hace poco. Espera un minuto antes de pedir otro.');
    else setResetSent(true);
  }

  const switchMode = (m: 'worker' | 'staff') => {
    setMode(m);
    setError(null);
    setMatch(null);
    localStorage.setItem('jornadia-login-mode', m);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'worker') {
        // Paso 1: mostrar empresa y nombre para que la persona confirme que es ella
        const found = await api<{ company: string; name: string; ready: boolean }>('/api/auth/worker/lookup', {
          body: { code, number },
        });
        setMatch(found);
        return;
      }
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (err) {
        setError(err.message.includes('Invalid login') ? 'Correo o contraseña incorrectos.' : 'No se pudo iniciar sesión. Revisa tu conexión.');
      }
    } catch (err) {
      setError(err instanceof NetworkError ? 'Sin conexión. Necesitas internet para entrar la primera vez.' : err instanceof ApiError ? err.message : 'No se pudo continuar.');
    } finally {
      setBusy(false);
    }
  }

  /** Paso 2: la persona confirmó; se canjea un token de un solo uso por la sesión. */
  async function confirmWorker() {
    setError(null);
    setBusy(true);
    try {
      const { token_hash } = await api<{ token_hash: string }>('/api/auth/worker/session', { body: { code, number } });
      const { error: err } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
      if (err) throw new Error('No se pudo iniciar sesión. Intenta de nuevo.');
      localStorage.setItem(CODE_KEY, code.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof NetworkError ? 'Sin conexión. Intenta de nuevo cuando tengas señal.' : err instanceof Error ? err.message : 'No se pudo continuar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="content" style={{ paddingTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Mark className="mark" />
          <h1>Jornadia</h1>
        </div>
        <p className="muted">Registra tu entrada y salida con selfie y ubicación.</p>

        <div className="segmented" role="group" aria-label="Tipo de cuenta">
          <button type="button" aria-pressed={mode === 'worker'} onClick={() => switchMode('worker')}>
            Trabajador
          </button>
          <button type="button" aria-pressed={mode === 'staff'} onClick={() => switchMode('staff')}>
            Administración
          </button>
        </div>

        {mode === 'worker' && match ? (
          <div className="stack">
            <div className="sheet" role="status">
              <p className="muted">{match.company}</p>
              <h2 style={{ fontSize: '1.7rem' }}>¿Eres {match.name}?</h2>
              <p className="muted">Número de empleado {number.trim()}</p>
            </div>
            {!match.ready && (
              <div className="notice warn">
                <strong>Falta tu foto de registro</strong>
                Antes de tu primera checada, tu supervisor debe tomarte la foto desde su celular. Búscalo y después vuelve a entrar.
              </div>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <button className="btn solid block" onClick={() => void confirmWorker()} disabled={busy || !match.ready}>
              {busy ? 'Entrando…' : 'Sí, soy yo'}
            </button>
            <button
              className="btn quiet block"
              onClick={() => {
                setMatch(null);
                setNumber('');
                setError(null);
              }}
            >
              No soy yo
            </button>
          </div>
        ) : mode === 'staff' && forgot ? (
          <form className="stack" onSubmit={sendReset} noValidate>
            <h2>Restablecer contraseña</h2>
            {resetSent ? (
              <div className="notice ok" role="status">
                <strong>Revisa tu correo</strong>
                Si {email} tiene una cuenta, te llegará un enlace para crear una contraseña nueva. Ábrelo en este mismo teléfono o
                computadora. Revisa también la carpeta de spam.
              </div>
            ) : (
              <>
                <p className="muted">Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.</p>
                <label className="field">
                  Correo
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
                </label>
                {error && (
                  <div className="notice error" role="alert">
                    {error}
                  </div>
                )}
                <button className="btn solid block" type="submit" disabled={busy || !email.includes('@')}>
                  {busy ? 'Enviando…' : 'Enviarme el enlace'}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn quiet block"
              onClick={() => {
                setForgot(false);
                setResetSent(false);
                setError(null);
              }}
            >
              Volver a iniciar sesión
            </button>
          </form>
        ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {mode === 'worker' ? (
            <>
              <label className="field">
                Código de empresa
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="organization"
                  required
                />
              </label>
              <label className="field">
                Número de empleado
                <input value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="username" autoCapitalize="none" required />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                Correo
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </label>
              <label className="field">
                Contraseña
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </label>
            </>
          )}

          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}

          <button
            className="btn solid block"
            type="submit"
            disabled={busy || (mode === 'worker' ? !code || !number : !email || !password)}
          >
            {busy ? (mode === 'worker' ? 'Buscando…' : 'Entrando…') : mode === 'worker' ? 'Continuar' : 'Entrar'}
          </button>
          {mode === 'staff' && (
            <button
              type="button"
              className="btn quiet block"
              onClick={() => {
                setForgot(true);
                setError(null);
              }}
            >
              ¿Olvidaste tu contraseña?
            </button>
          )}
        </form>
        )}

        <div className="spacer" />
        <WhatsAppLink text="Hola, necesito ayuda para entrar a Jornadia." label="¿Necesitas ayuda? Escríbenos por WhatsApp" />
      </div>
    </div>
  );
}
