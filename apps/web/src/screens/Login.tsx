import { useState, type FormEvent } from 'react';
import { workerEmail } from '@jornadia/core';
import { supabase } from '../lib/supabase';
import { Mark, WhatsAppLink } from '../common';

const CODE_KEY = 'jornadia-company-code';

export function Login() {
  const [mode, setMode] = useState<'worker' | 'staff'>(() => (localStorage.getItem('jornadia-login-mode') === 'staff' ? 'staff' : 'worker'));
  const [code, setCode] = useState(localStorage.getItem(CODE_KEY) ?? '');
  const [number, setNumber] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (m: 'worker' | 'staff') => {
    setMode(m);
    setError(null);
    localStorage.setItem('jornadia-login-mode', m);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const credentials =
        mode === 'worker'
          ? { email: workerEmail(number, code), password: pin }
          : { email: email.trim().toLowerCase(), password };
      const { error: err } = await supabase.auth.signInWithPassword(credentials);
      if (err) {
        setError(
          err.message.includes('Invalid login')
            ? mode === 'worker'
              ? 'Código de empresa, número de empleado o NIP incorrectos.'
              : 'Correo o contraseña incorrectos.'
            : 'No se pudo iniciar sesión. Revisa tu conexión.',
        );
      } else if (mode === 'worker') {
        localStorage.setItem(CODE_KEY, code.trim().toLowerCase());
      }
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
              <label className="field">
                NIP
                <input
                  className="pin"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  type="password"
                  autoComplete="current-password"
                  maxLength={6}
                  required
                />
                <small>6 dígitos. Si lo olvidaste, pide a tu supervisor que lo reinicie.</small>
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
            disabled={busy || (mode === 'worker' ? !code || !number || pin.length !== 6 : !email || !password)}
          >
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <div className="spacer" />
        <WhatsAppLink text="Hola, necesito ayuda para entrar a Jornadia." label="¿Necesitas ayuda? Escríbenos por WhatsApp" />
      </div>
    </div>
  );
}
