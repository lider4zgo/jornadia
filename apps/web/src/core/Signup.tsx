import { useEffect, useRef, useState, type FormEvent } from 'react';
import { INDUSTRIES, isValidCompanyRfc, LEGAL_URLS, LEGAL_VERSIONS, MX_STATES, normalizeOrigin, STARTER } from '@korporia/core';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { Logo, Spinner, WhatsAppLink } from '../common';
import type { Me } from '../types';
import { EmailCode, sendCode } from './EmailCode';

/** Datos del registro que esperan a que la persona confirme su correo con el código. */
type PendingSignup = {
  full_name: string;
  company_name: string;
  employees: number;
  industry: string;
  state: string;
  rfc: string;
  phone: string;
  origin: string | null;
  marketing_opt_out: boolean;
  accept_terms: true;
  terms_version: string;
  privacy_version: string;
};

const PENDING_KEY = 'korporia-signup';

function readPending(): PendingSignup | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    const p = raw ? (JSON.parse(raw) as PendingSignup) : null;
    // Si los términos cambiaron mientras tanto, se vuelven a pedir
    return p && p.terms_version === LEGAL_VERSIONS.terminos && p.privacy_version === LEGAL_VERSIONS.privacidad ? p : null;
  } catch {
    return null;
  }
}

const SALES_WHATSAPP = '528718963470';

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

/** Campos de la empresa y aceptación legal: los comparten el registro y "completa tu registro". */
function CompanyFields({
  value,
  onChange,
}: {
  value: Omit<PendingSignup, 'accept_terms' | 'terms_version' | 'privacy_version'> & { accept: boolean };
  onChange: (patch: Partial<typeof value>) => void;
}) {
  const tooBig = value.employees > STARTER.maxEmployees;
  return (
    <>
      <label className="field">
        Nombre de tu empresa
        <input value={value.company_name} onChange={(e) => onChange({ company_name: e.target.value })} autoComplete="organization" required />
      </label>
      <label className="field">
        ¿Cuántos empleados tiene?
        <input
          type="number"
          min={1}
          max={100000}
          value={value.employees || ''}
          onChange={(e) => onChange({ employees: Number(e.target.value) })}
          inputMode="numeric"
          required
        />
      </label>
      {tooBig && (
        <div className="notice warn">
          <strong>Korporia Starter es para equipos de hasta {STARTER.maxEmployees} empleados</strong>
          Para tu equipo, empieza con Jornada, que ya incluye RH básico. Escríbenos y te damos de alta hoy mismo.
          <div style={{ marginTop: 8 }}>
            <a
              className="btn small solid"
              href={`https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(`Hola, quiero empezar con Korporia Jornada (${value.employees} empleados).`)}`}
              target="_blank"
              rel="noreferrer"
            >
              Escribir por WhatsApp
            </a>
          </div>
        </div>
      )}
      <div className="form-grid">
        <label className="field">
          RFC de la empresa
          <input
            value={value.rfc}
            onChange={(e) => onChange({ rfc: e.target.value.toUpperCase().replace(/\s/g, '') })}
            maxLength={13}
            autoCapitalize="characters"
            placeholder="12 o 13 caracteres"
            required
          />
          {value.rfc.length >= 12 && !isValidCompanyRfc(value.rfc) && <span className="muted">Revisa el RFC.</span>}
        </label>
        <label className="field">
          Teléfono de contacto
          <input type="tel" value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} inputMode="tel" autoComplete="tel" required />
        </label>
      </div>
      <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>Una cuenta de Korporia Starter por empresa (RFC). No te mandamos SMS.</p>
      <div className="form-grid">
        <label className="field">
          Giro
          <select value={value.industry} onChange={(e) => onChange({ industry: e.target.value })} required>
            <option value="">Elige uno</option>
            {INDUSTRIES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Estado
          <select value={value.state} onChange={(e) => onChange({ state: e.target.value })} required>
            <option value="">Elige uno</option>
            {MX_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={value.accept} onChange={(e) => onChange({ accept: e.target.checked })} required />
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
        <input type="checkbox" checked={value.marketing_opt_out} onChange={(e) => onChange({ marketing_opt_out: e.target.checked })} />
        <span>No deseo recibir novedades ni encuestas</span>
      </label>
    </>
  );
}

type FormState = Omit<PendingSignup, 'accept_terms' | 'terms_version' | 'privacy_version'> & { accept: boolean };

const emptyForm = (): FormState => ({
  full_name: '',
  company_name: '',
  employees: 0,
  industry: '',
  state: '',
  rfc: '',
  phone: '',
  origin: null,
  marketing_opt_out: false,
  accept: false,
});

const formValid = (f: FormState) =>
  f.company_name.trim().length >= 2 &&
  f.employees >= 1 &&
  f.employees <= STARTER.maxEmployees &&
  Boolean(f.industry) &&
  Boolean(f.state) &&
  isValidCompanyRfc(f.rfc) &&
  f.phone.replace(/\D/g, '').length >= 10 &&
  f.accept;

const toPending = (f: FormState): PendingSignup => ({
  full_name: f.full_name.trim(),
  company_name: f.company_name.trim(),
  employees: f.employees,
  industry: f.industry,
  state: f.state,
  rfc: f.rfc.trim().toUpperCase(),
  phone: f.phone.trim(),
  origin: f.origin ?? readOrigin(),
  marketing_opt_out: f.marketing_opt_out,
  accept_terms: true,
  terms_version: LEGAL_VERSIONS.terminos,
  privacy_version: LEGAL_VERSIONS.privacidad,
});

/** Registro por autoservicio en Korporia Starter (sin sesión): datos → código por correo → empresa creada. */
readOrigin();

export function Signup() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!formValid(form) || !form.full_name.trim()) return;
    setBusy(true);
    setError(null);
    const address = email.trim().toLowerCase();
    try {
      await api('/api/core/signup/start', { body: { email: address, full_name: form.full_name.trim() } });
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(toPending(form)));
      const msg = await sendCode(address);
      if (msg) setError(msg === 'NO_ACCOUNT' ? 'No pudimos preparar tu cuenta. Intenta de nuevo.' : msg);
      else {
        setEmail(address);
        setStep('code');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.');
    } finally {
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

        {step === 'code' ? (
          <EmailCode email={email} onBack={() => setStep('form')} busyLabel="Creando tu cuenta…" />
        ) : (
          <form className="stack" onSubmit={submit} noValidate>
            <label className="field">
              Tu nombre
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} autoComplete="name" required />
            </label>
            <label className="field">
              Correo
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              <small>Te enviaremos un código para confirmar tu correo; después crearás tu contraseña.</small>
            </label>
            <CompanyFields value={form} onChange={(p) => setForm({ ...form, ...p })} />
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <button className="btn solid block" type="submit" disabled={busy || !formValid(form) || !form.full_name.trim() || !email.includes('@')}>
              {busy ? 'Enviando…' : 'Enviarme el código'}
            </button>
            <button type="button" className="btn quiet block" onClick={() => navigate('/')}>
              Ya tengo cuenta: iniciar sesión
            </button>
          </form>
        )}
        <div className="spacer" />
        <WhatsAppLink text="Hola, tengo una duda para registrarme en Korporia." label="¿Dudas? Escríbenos por WhatsApp" />
      </div>
    </div>
  );
}

/**
 * Sesión iniciada pero sin empresa: termina el registro. Si el registro ya trae los datos
 * (paso anterior), crea la empresa sola; si no (por ejemplo, entró con Google), los pide.
 */
export function CompleteSignup({ me, onDone, onSignOut }: { me: Me; onDone: () => Promise<void>; onSignOut: () => void }) {
  const pending = useRef(readPending());
  const [form, setForm] = useState<FormState>(() => (pending.current ? { ...pending.current, accept: true } : emptyForm()));
  const [busy, setBusy] = useState(Boolean(pending.current));
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function complete(data: PendingSignup) {
    setBusy(true);
    setError(null);
    try {
      await api('/api/core/signup/complete', { body: data });
      sessionStorage.removeItem(PENDING_KEY);
      navigate('/jornada', { replace: true });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.');
      setBusy(false);
    }
  }

  useEffect(() => {
    if (pending.current && !started.current) {
      started.current = true;
      void complete(pending.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (busy && !error) return <Spinner label="Creando tu empresa…" />;

  return (
    <div className="content" style={{ paddingBottom: 48 }}>
      <h1>Completa tu registro</h1>
      <p className="muted">Faltan los datos de tu empresa para activar Korporia Starter.</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (formValid(form)) void complete(toPending({ ...form, full_name: form.full_name || '' }));
        }}
        noValidate
      >
        <CompanyFields value={form} onChange={(p) => setForm({ ...form, ...p })} />
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="btn solid block" type="submit" disabled={busy || !formValid(form)}>
          {busy ? 'Creando tu empresa…' : 'Crear mi empresa'}
        </button>
        <button type="button" className="btn quiet block" onClick={onSignOut}>
          Salir
        </button>
      </form>
      {me.isPlatformAdmin && <p className="muted">Eres administrador de la plataforma: también puedes crear empresas para clientes.</p>}
    </div>
  );
}
