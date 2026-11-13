import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { deviceToken, passwordProblem, saveDeviceToken, type DeviceStatus } from '../lib/trust';
import { Mark, Spinner } from '../common';

/**
 * Segundo paso del administrador (Dirección, 13 nov 2026). Se muestra cuando la sesión todavía no
 * está confirmada en este dispositivo:
 *  - entró con contraseña en un dispositivo nuevo (o pasaron 30 días): código de 6 dígitos al correo;
 *  - entró con el código del correo (registro u olvidó su contraseña): crea su contraseña.
 */
export function DeviceGate({ userId, onVerified, onSignOut }: { userId: string; onVerified: () => void; onSignOut: () => void }) {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setError(null);
    try {
      const s = await api<DeviceStatus>('/api/core/device/check', { body: { device_token: deviceToken(userId) ?? '' } });
      if (s.verified) onVerified();
      else setStatus(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.');
    }
  }, [userId, onVerified]);

  useEffect(() => {
    void check();
  }, [check]);

  if (error && !status) {
    return (
      <Frame title="No se pudo continuar">
        <div className="notice error">{error}</div>
        <button className="btn block" onClick={() => void check()}>
          Intentar de nuevo
        </button>
        <button className="btn quiet block" onClick={onSignOut}>
          Salir
        </button>
      </Frame>
    );
  }
  if (!status) return <Spinner label="Revisando tu dispositivo…" />;

  if (status.needsPassword) {
    if (!status.canSetPassword) {
      return (
        <Frame title="Vuelve a entrar">
          <p className="muted">Por seguridad, entra con tu correo y tu contraseña. Si no la tienes o la olvidaste, elige "¿Olvidaste tu contraseña?".</p>
          <button className="btn solid block" onClick={onSignOut}>
            Ir al inicio de sesión
          </button>
        </Frame>
      );
    }
    return (
      <CreatePassword
        title="Crea tu contraseña"
        intro="Con ella vas a entrar a Korporia. En un dispositivo nuevo, y cada 30 días, también te pediremos un código que llega a tu correo."
        onSaved={(token) => {
          saveDeviceToken(userId, token);
          onVerified();
        }}
        onCancel={onSignOut}
      />
    );
  }

  return (
    <EmailCodeStep
      email={status.email ?? ''}
      purpose="device"
      title="Confirma que eres tú"
      intro="Es la primera vez que entras desde este dispositivo o pasaron 30 días. Te enviamos un código a tu correo."
      onVerified={(token) => {
        saveDeviceToken(userId, token);
        onVerified();
      }}
      onCancel={onSignOut}
      cancelLabel="Salir"
    />
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="shell">
      <div className="content stack" style={{ paddingTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Mark className="mark" />
          <h1 style={{ margin: 0 }}>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Pide un código al correo, lo valida y devuelve el token del dispositivo (si aplica). */
export function EmailCodeStep({
  email,
  purpose,
  title,
  intro,
  onVerified,
  onCancel,
  cancelLabel = 'Cancelar',
  framed = true,
}: {
  email: string;
  purpose: 'device' | 'sensitive';
  title: string;
  intro: string;
  onVerified: (deviceToken?: string) => void;
  onCancel: () => void;
  cancelLabel?: string;
  framed?: boolean;
}) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  const send = useCallback(async () => {
    setError(null);
    setInfo(null);
    try {
      await api('/api/core/device/send', { body: { purpose } });
      setSent(true);
      setWait(60);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo enviar el código. Revisa tu conexión.');
    }
  }, [purpose]);

  useEffect(() => {
    void send();
  }, [send]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ device_token?: string }>('/api/core/device/verify', { body: { code, purpose } });
      onVerified(r.device_token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo validar el código.');
      setBusy(false);
    }
  }

  const body = (
    <form className="stack" onSubmit={verify} noValidate>
      <p className="muted" style={{ margin: 0 }}>
        {intro}
        {sent && email ? (
          <>
            {' '}
            Revisa <strong>{email}</strong> (y la carpeta de correo no deseado).
          </>
        ) : null}
      </p>
      <label className="field">
        Código de 6 números
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          style={{ fontSize: '1.5rem', letterSpacing: '0.4em' }}
        />
      </label>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {info && <div className="notice">{info}</div>}
      <button className="btn solid block" type="submit" disabled={busy || code.length !== 6}>
        {busy ? 'Validando…' : 'Confirmar'}
      </button>
      <button
        type="button"
        className="btn quiet block"
        disabled={wait > 0}
        onClick={() => void send().then(() => setInfo('Te enviamos un código nuevo.'))}
      >
        {wait > 0 ? `Pedir otro código en ${wait} s` : 'Pedir otro código'}
      </button>
      <button type="button" className="btn quiet block" onClick={onCancel}>
        {cancelLabel}
      </button>
    </form>
  );
  return framed ? <Frame title={title}>{body}</Frame> : body;
}

/** Crea o cambia la contraseña con la API (que exige el código del correo). */
export function CreatePassword({
  title,
  intro,
  onSaved,
  onCancel,
  framed = true,
}: {
  title: string;
  intro: string;
  onSaved: (deviceToken?: string) => void;
  onCancel: () => void;
  framed?: boolean;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = password ? passwordProblem(password) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem || password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ device_token?: string }>('/api/core/account/password', { body: { password } });
      onSaved(r.device_token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la contraseña.');
      setBusy(false);
    }
  }

  const body = (
    <form className="stack" onSubmit={submit} noValidate>
      <p className="muted" style={{ margin: 0 }}>
        {intro}
      </p>
      <label className="field">
        Contraseña
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        <small>{problem ?? 'Al menos 10 caracteres, con letras y números.'}</small>
      </label>
      <label className="field">
        Repite la contraseña
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        {confirm && confirm !== password && <small style={{ color: 'var(--stop)' }}>Las contraseñas no coinciden.</small>}
      </label>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <button className="btn solid block" type="submit" disabled={busy || Boolean(problem) || !password || password !== confirm}>
        {busy ? 'Guardando…' : 'Guardar contraseña'}
      </button>
      <button type="button" className="btn quiet block" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  );
  return framed ? <Frame title={title}>{body}</Frame> : body;
}
