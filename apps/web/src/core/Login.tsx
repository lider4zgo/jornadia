import { useState, type FormEvent } from 'react';
import { api, ApiError, NetworkError } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Logo, WhatsAppLink } from '../common';
import { navigate } from '../lib/router';
import { EmailCode, sendCode } from './EmailCode';
import { OAuthButtons } from './OAuthButtons';

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
  const [match, setMatch] = useState<{ company: string; name: string; hasPin: boolean; activationPending: boolean } | null>(null);
  // Trabajador: PIN (ya activó su acceso) o código de activación + PIN nuevo (primera vez)
  const [pin, setPin] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [activating, setActivating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Administración: correo y contraseña; el código por correo solo sirve para crear o recuperar la contraseña
  const [staffMethod, setStaffMethod] = useState<'code' | 'password'>('password');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);

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
        const found = await api<{ company: string; name: string; hasPin: boolean; activationPending: boolean }>('/api/core/worker-access/lookup', {
          body: { code, number },
        });
        setMatch(found);
        setActivating(!found.hasPin);
        setPin('');
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

  /** Paso 2: entra con su PIN o, la primera vez, activa su acceso y crea su PIN. */
  async function confirmWorker(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    if (activating) {
      if (!/^\d{4}$/.test(newPin)) return setError('Tu PIN debe tener 4 números.');
      if (newPin !== newPin2) return setError('Los dos PIN no coinciden.');
    }
    setBusy(true);
    try {
      const { token_hash } = activating
        ? await api<{ token_hash: string }>('/api/core/worker-access/activate', {
            body: { code, number, activation_code: activationCode.replace(/\s/g, ''), pin: newPin },
          })
        : await api<{ token_hash: string }>('/api/core/worker-access/session', { body: { code, number, pin } });
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
          <form className="stack" onSubmit={(e) => void confirmWorker(e)} noValidate>
            <div className="sheet" role="status">
              <p className="muted">{match.company}</p>
              <h2 style={{ fontSize: '1.7rem' }}>¿Eres {match.name}?</h2>
              <p className="muted">Número de empleado {number.trim()}</p>
            </div>
            {activating ? (
              <>
                <p className="muted" style={{ margin: 0 }}>
                  Primera vez: escribe el código de activación que te dio tu supervisor y crea un PIN de 4 números. Con él entrarás y
                  firmarás tus documentos.
                </p>
                <label className="field">
                  Código de activación
                  <input
                    value={activationCode}
                    onChange={(e) => setActivationCode(e.target.value.replace(/[^\d\s]/g, ''))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    required
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    Crea tu PIN
                    <input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="new-password" required />
                  </label>
                  <label className="field">
                    Repite tu PIN
                    <input type="password" value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="new-password" required />
                  </label>
                </div>
                <small className="muted">No uses 1234 ni 1111. No se lo compartas a nadie.</small>
              </>
            ) : (
              <label className="field">
                Tu PIN
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="current-password"
                  required
                  autoFocus
                  style={{ letterSpacing: '0.4em', fontSize: '1.4rem', textAlign: 'center' }}
                />
              </label>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <button
              className="btn solid block"
              type="submit"
              disabled={busy || (activating ? activationCode.replace(/\s/g, '').length < 6 || newPin.length < 4 || newPin2.length < 4 : pin.length < 4)}
            >
              {busy ? 'Entrando…' : activating ? 'Activar y entrar' : 'Entrar'}
            </button>
            {match.hasPin && (
              <button type="button" className="btn quiet block" onClick={() => { setActivating(!activating); setError(null); }}>
                {activating ? 'Ya tengo PIN' : 'Olvidé mi PIN (tengo un código nuevo)'}
              </button>
            )}
            <button
              type="button"
              className="btn quiet block"
              onClick={() => {
                setMatch(null);
                setNumber('');
                setError(null);
              }}
            >
              No soy yo
            </button>
          </form>
        ) : mode === 'staff' && codeSentTo ? (
          <EmailCode email={codeSentTo} onBack={() => setCodeSentTo(null)} />
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
                  Te enviaremos un código a tu correo. Después crearás una contraseña nueva.
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
              {staffMethod === 'password' && <OAuthButtons />}
              <button
                type="button"
                className="btn quiet block"
                onClick={() => {
                  setStaffMethod(staffMethod === 'code' ? 'password' : 'code');
                  setError(null);
                }}
              >
                {staffMethod === 'code' ? 'Volver a entrar con contraseña' : '¿Olvidaste tu contraseña o aún no tienes una?'}
              </button>
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
