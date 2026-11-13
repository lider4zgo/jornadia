import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isValidCompanyRfc, LEGAL_URLS, LEGAL_VERSIONS, normalizeOrigin, STARTER } from '@korporia/core';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { supabase } from '../lib/supabase';
import { passwordProblem } from '../lib/trust';
import { Logo, Spinner, WhatsAppLink } from '../common';
import type { Me } from '../types';
import { OAuthButtons } from './OAuthButtons';

/**
 * Registro de Korporia Starter (Erik, 13 nov 2026):
 *  1. Correo y contraseña (o Google / Microsoft) y aceptación de términos.
 *  2. Código de 6 dígitos al correo (el segundo paso confirma el correo).
 *  3. Nombre de la empresa, RFC y número de empleados. Lo demás, después en los perfiles.
 */
type Pending = {
  accept_terms: true;
  terms_version: string;
  privacy_version: string;
  marketing_opt_out: boolean;
  origin: string | null;
};

const PENDING_KEY = 'korporia-signup';
const SALES_WHATSAPP = '528718963470';

function readPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    // Si los términos cambiaron mientras tanto, se vuelven a pedir
    return p && p.terms_version === LEGAL_VERSIONS.terminos && p.privacy_version === LEGAL_VERSIONS.privacidad ? p : null;
  } catch {
    return null;
  }
}

function savePending(p: Pending) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* navegación privada: los términos se vuelven a pedir al crear la empresa */
  }
}

/** Origen del registro (?origen= de la guía, el sitio o el enlace de un despacho); se guarda durante la visita. */
const ORIGIN_KEY = 'korporia-origen';
function readOrigin(): string | null {
  try {
    const fromUrl = normalizeOrigin(new URLSearchParams(window.location.search).get('origen'));
    if (fromUrl) sessionStorage.setItem(ORIGIN_KEY, fromUrl);
    return fromUrl ?? normalizeOrigin(sessionStorage.getItem(ORIGIN_KEY));
  } catch {
    return null;
  }
}
readOrigin();

function TermsCheck({ accept, optOut, onAccept, onOptOut }: { accept: boolean; optOut: boolean; onAccept: (v: boolean) => void; onOptOut: (v: boolean) => void }) {
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={accept} onChange={(e) => onAccept(e.target.checked)} required />
        <span>
          Acepto los{' '}
          <a href={LEGAL_URLS.terminos} target="_blank" rel="noreferrer">
            Términos y condiciones
          </a>{' '}
          (versión {LEGAL_VERSIONS.terminos}) y el{' '}
          <a href={LEGAL_URLS.privacidad} target="_blank" rel="noreferrer">
            Aviso de privacidad
          </a>
          , en nombre de mi empresa.
        </span>
      </label>
      <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
        Korporia (Erik Rodrigo Martínez Canales) usará tus datos para crear y administrar tu cuenta y, si no lo rechazas, para enviarte
        novedades y encuestas. Consulta el{' '}
        <a href={LEGAL_URLS.privacidad} target="_blank" rel="noreferrer">
          aviso de privacidad
        </a>
        .
      </p>
      <label className="check">
        <input type="checkbox" checked={optOut} onChange={(e) => onOptOut(e.target.checked)} />
        <span>No deseo recibir novedades ni encuestas</span>
      </label>
    </>
  );
}

/** Paso 1 (sin sesión): correo y contraseña, o Google / Microsoft. */
export function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accept, setAccept] = useState(false);
  const [optOut, setOptOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = password ? passwordProblem(password) : null;
  const pending = (): Pending => ({
    accept_terms: true,
    terms_version: LEGAL_VERSIONS.terminos,
    privacy_version: LEGAL_VERSIONS.privacidad,
    marketing_opt_out: optOut,
    origin: readOrigin(),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem || password !== confirm || !accept) return;
    setBusy(true);
    setError(null);
    const address = email.trim().toLowerCase();
    try {
      await api('/api/core/signup/start', { body: { email: address, password, accept_terms: true } });
      savePending(pending());
      // Entra con la contraseña; el segundo paso manda el código al correo y así lo confirma
      const { error: err } = await supabase.auth.signInWithPassword({ email: address, password });
      if (err) throw new Error('Tu cuenta quedó creada, pero no pudimos entrar. Inicia sesión con tu correo y contraseña.');
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.');
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="content" style={{ paddingTop: 32, paddingBottom: 48 }}>
        <a href="https://korporia.com" aria-label="Korporia" style={{ textDecoration: 'none' }}>
          <Logo as="h1" size={28} />
        </a>
        <h2 style={{ marginTop: 20 }}>Crea tu cuenta gratis</h2>
        <p className="muted">
          Korporia Starter: checador completo 3 meses y RH básico 6 meses, para equipos de hasta {STARTER.maxEmployees} empleados. Sin
          tarjeta.
        </p>

        <form className="stack" onSubmit={submit} noValidate>
          <label className="field">
            Correo
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
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
          <TermsCheck accept={accept} optOut={optOut} onAccept={setAccept} onOptOut={setOptOut} />
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button
            className="btn solid block"
            type="submit"
            disabled={busy || !email.includes('@') || Boolean(problem) || !password || password !== confirm || !accept}
          >
            {busy ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
          </button>
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            Te enviaremos un código a tu correo para confirmarlo.
          </p>
          <OAuthButtons
            disabled={!accept}
            hint={!accept ? 'Para continuar con Google o Microsoft, primero acepta los términos y el aviso.' : undefined}
            onBeforeRedirect={() => savePending(pending())}
          />
          <button type="button" className="btn quiet block" onClick={() => navigate('/')}>
            Ya tengo cuenta: iniciar sesión
          </button>
        </form>
        <div className="spacer" />
        <WhatsAppLink text="Hola, tengo una duda para registrarme en Korporia." label="¿Dudas? Escríbenos por WhatsApp" />
      </div>
    </div>
  );
}

/**
 * Paso 3 (sesión verificada, sin empresa): nombre de la empresa, RFC y número de empleados.
 * Si la persona no aceptó los términos en el paso 1 (por ejemplo, entró con Google desde
 * "Iniciar sesión"), se le piden aquí.
 */
export function CompleteSignup({ me, onDone, onSignOut }: { me: Me; onDone: () => Promise<void>; onSignOut: () => void }) {
  const pending = useRef(readPending());
  const [companyName, setCompanyName] = useState('');
  const [rfc, setRfc] = useState('');
  const [employees, setEmployees] = useState(0);
  const [accept, setAccept] = useState(Boolean(pending.current));
  const [optOut, setOptOut] = useState(pending.current?.marketing_opt_out ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooBig = employees > STARTER.maxEmployees;
  const valid = companyName.trim().length >= 2 && isValidCompanyRfc(rfc) && employees >= 1 && !tooBig && accept;

  useEffect(() => {
    void me; // la empresa se crea para el usuario de la sesión
  }, [me]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/core/signup/complete', {
        body: {
          company_name: companyName.trim(),
          rfc: rfc.trim().toUpperCase(),
          employees,
          accept_terms: true,
          terms_version: LEGAL_VERSIONS.terminos,
          privacy_version: LEGAL_VERSIONS.privacidad,
          marketing_opt_out: optOut,
          origin: pending.current?.origin ?? readOrigin(),
        },
      });
      try {
        sessionStorage.removeItem(PENDING_KEY);
      } catch {
        /* sin almacenamiento */
      }
      navigate('/rh/empresa', { replace: true });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.');
      setBusy(false);
    }
  }

  if (busy && !error) return <Spinner label="Creando tu empresa…" />;

  return (
    <div className="content" style={{ paddingBottom: 48 }}>
      <h1>Tu empresa</h1>
      <p className="muted">Con estos datos activamos Korporia Starter. Lo demás (domicilio, giro, razón social) lo completas después en el perfil de la empresa.</p>
      <form className="stack" onSubmit={submit} noValidate>
        <label className="field">
          Nombre de tu empresa
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" required />
        </label>
        <label className="field">
          RFC de la empresa
          <input
            value={rfc}
            onChange={(e) => setRfc(e.target.value.toUpperCase().replace(/\s/g, ''))}
            maxLength={13}
            autoCapitalize="characters"
            placeholder="12 o 13 caracteres"
            required
          />
          <small>{rfc.length >= 12 && !isValidCompanyRfc(rfc) ? 'Revisa el RFC.' : 'Una cuenta de Korporia Starter por empresa (RFC).'}</small>
        </label>
        <label className="field">
          ¿Cuántos empleados tiene?
          <input type="number" min={1} max={100000} value={employees || ''} onChange={(e) => setEmployees(Number(e.target.value))} inputMode="numeric" required />
        </label>
        {tooBig && (
          <div className="notice warn">
            <strong>Korporia Starter es para equipos de hasta {STARTER.maxEmployees} empleados</strong>
            Para tu equipo, empieza con Jornada, que ya incluye RH básico. Escríbenos y te damos de alta hoy mismo.
            <div style={{ marginTop: 8 }}>
              <a
                className="btn small solid"
                href={`https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(`Hola, quiero empezar con Korporia Jornada (${employees} empleados).`)}`}
                target="_blank"
                rel="noreferrer"
              >
                Escribir por WhatsApp
              </a>
            </div>
          </div>
        )}
        {!pending.current && <TermsCheck accept={accept} optOut={optOut} onAccept={setAccept} onOptOut={setOptOut} />}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="btn solid block" type="submit" disabled={busy || !valid}>
          {busy ? 'Creando tu empresa…' : 'Activar Korporia Starter'}
        </button>
        <button type="button" className="btn quiet block" onClick={onSignOut}>
          Salir
        </button>
      </form>
    </div>
  );
}
