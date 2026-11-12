import { useState, type FormEvent } from 'react';
import { api, ApiError, NetworkError } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Logo, WhatsAppLink } from '../common';
import { navigate } from '../lib/router';
import { EmailCode, sendCode } from './EmailCode';

const CODE_KEY = 'korporia-company-code';

/** Traduce el error de Supabase Auth a un mensaje claro, sin ocultar la causa real. */
function signInErrorMessage(err: { message: string; status?: number; name?: string }): string {
  const msg = err.message ?? '';
  if (/invalid login/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Tu correo no está confirmado. Pide que confirmen tu usuario.';
  if (/api key|apikey/i.test(msg) || err.status === 401) return 'La app no está bien configurada: la llave de Supabase no es válida. Avisa a soporte.';
  if (err.name === 'AuthRetryableFetchError' || err.status === 0 || /fetch/i.test(msg)) {
    return 'No se pudo conectar con el servidor de inicio de sesión. Revisa tu conexión.';
  }
  return `No se pudo iniciar sesión (${err.status ?? 'sin código'}): ${msg}`;
}

export function Login() {
  const [mode, setMode] = useState<'worker' | 'staff'>(() => (localStorage.getItem('korporia-login-mode') === 'staff' ? 'staff' : 'worker'));
  const [code, setCode] = useState(localStorage.getItem(CODE_KEY) ?? '');
  const [number, setNumber] = useState('');
  const [match, setMatch] = useState<{ company: string; name: string; ready: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // Administración: código por correo (sin contraseña) o, como respaldo, contraseña
  const [staffMethod, setStaffMethod] = useState<'code' | 'password'>('code');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);

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
    setCodeSentTo(null);
    setNoAccount(false);
    localStorage.setItem('korporia-login-mode', m);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    if (mode === 'staff' && staffMethod === 'code') {
      const address = email.trim().toLowerCase();
      const msg = await sendCode(address);
      setBusy(false);
      setNoAccount(msg === 'NO_ACCOUNT');
      if (msg === 'NO_ACCOUNT') setError('No encontramos una cuenta con ese correo.');
      else if (msg) setError(msg);
      else setCodeSentTo(address);
      return;
    }
    try {
      if (mode === 'worker') {
        // Paso 1: mostrar empresa y nombre para que la persona confirme que es ella
        const found = await api<{ company: string; name: string; ready: boolean }>('/api/jornada/auth/lookup', {
          body: { code, number },
        });
        setMatch(found);
        return;
      }
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (err) setError(signInErrorMessage(err));
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
      const { token_hash } = await api<{ token_hash: string }>('/api/jornada/auth/session', { body: { code, number } });
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
        <Logo as="h1" size={30} />
        <p className="muted">Recursos humanos y asistencia de tu empresa, en un solo lugar.</p>

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
        ) : mode === 'staff' && codeSentTo ? (
          <EmailCode email={codeSentTo} onBack={() => setCodeSentTo(null)} />
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
              {staffMethod === 'password' ? (
                <label className="field">
                  Contraseña
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                </label>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Te enviaremos un código a tu correo para entrar, sin contraseñas.
                </p>
              )}
            </>
          )}

          {error && (
            <div className="notice error" role="alert">
              {error}
              {noAccount && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn small solid" onClick={() => navigate('/registro')}>
                    Crear mi cuenta gratis
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            className="btn solid block"
            type="submit"
            disabled={busy || (mode === 'worker' ? !code || !number : !email.includes('@') || (staffMethod === 'password' && !password))}
          >
            {busy
              ? mode === 'worker'
                ? 'Buscando…'
                : 'Enviando…'
              : mode === 'worker'
                ? 'Continuar'
                : staffMethod === 'code'
                  ? 'Enviarme el código'
                  : 'Entrar'}
          </button>
          {mode === 'staff' && (
            <>
              <button
                type="button"
                className="btn quiet block"
                onClick={() => {
                  setStaffMethod(staffMethod === 'code' ? 'password' : 'code');
                  setError(null);
                }}
              >
                {staffMethod === 'code' ? 'Entrar con contraseña' : 'Entrar con código por correo'}
              </button>
              {staffMethod === 'password' && (
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
              <button type="button" className="btn quiet block" onClick={() => navigate('/registro')}>
                ¿Tu empresa aún no usa Korporia? Crea tu cuenta gratis
              </button>
            </>
          )}
        </form>
        )}

        <div className="spacer" />
        <WhatsAppLink text="Hola, necesito ayuda para entrar a Korporia." label="¿Necesitas ayuda? Escríbenos por WhatsApp" />
      </div>
    </div>
  );
}
