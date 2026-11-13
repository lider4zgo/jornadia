import { LEGAL_URLS } from '@korporia/core';
import { useEffect, useState, type ReactNode } from 'react';
import { serverNow } from './lib/clock';

const K_COLORS = {
  korporia: { stem: '#2B3FD1', arm: '#12A37E' },
  jornada: { stem: '#0E1630', arm: '#F0A23B' },
} as const;

/**
 * Símbolo K de Korporia (retícula de 48 unidades): fuste y pierna en índigo,
 * brazo que sube en verde. Submarca de módulo: fuste y pierna en tinta, brazo del color del módulo.
 */
export function Mark({
  className = 'mark',
  variant = 'korporia',
  size,
}: {
  className?: string;
  variant?: keyof typeof K_COLORS;
  size?: number;
}) {
  const c = K_COLORS[variant];
  return (
    <svg className={className} viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <rect x="6" y="4" width="10" height="40" fill={c.stem} />
      <polygon points="18,24 32,4 44,4 30,24" fill={c.arm} />
      <polygon points="18,24 30,24 44,44 32,44" fill={c.stem} />
    </svg>
  );
}

/** Logo horizontal: símbolo + nombre. */
export function Logo({ size = 28, as: Tag = 'span' }: { size?: number; as?: 'span' | 'h1' }) {
  return (
    <Tag className="logo" style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3, margin: 0 }}>
      <Mark className="" size={Math.round(size * 1.25)} />
      <span className="wordmark" style={{ fontSize: size, lineHeight: 1 }}>
        Korporia
      </span>
    </Tag>
  );
}

/** Hora estimada del servidor, actualizada cada segundo. */
export function useServerNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

const SUPPORT = (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined) ?? '';
export const SUPPORT_EMAIL = 'soporte@korporia.com';
export const PRIVACY_EMAIL = 'privacidad@korporia.com';

/** PLT-04: aviso de privacidad, derechos ARCO y términos, siempre a la mano. */
export function LegalFooter() {
  return (
    <footer className="legal-footer">
      <a href={LEGAL_URLS.privacidad} target="_blank" rel="noreferrer">
        Aviso de privacidad
      </a>
      <a href={`mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent('Solicitud de derechos ARCO')}`}>Derechos ARCO</a>
      <a href={LEGAL_URLS.terminos} target="_blank" rel="noreferrer">
        Términos
      </a>
      <a href="https://korporia.com/subencargados" target="_blank" rel="noreferrer">
        Subencargados
      </a>
    </footer>
  );
}

export function WhatsAppLink({ number, text, label = 'Soporte' }: { number?: string | null; text?: string; label?: string }) {
  const n = (number || SUPPORT).replace(/\D/g, '');
  if (!n) return null;
  const href = `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  return (
    <a className="whatsapp" href={href} target="_blank" rel="noreferrer">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#0B7A5E"
          d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"
        />
      </svg>
      {label}
    </a>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="content center" role="status" style={{ justifyContent: 'center' }}>
      <Mark className="mark" />
      <p className="muted">{label}</p>
    </div>
  );
}

/** Ventana sobre la pantalla (formularios cortos). Se cierra con Esc o tocando fuera. */
export function Modal({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="sheet" style={{ width: `min(100%, ${width}px)`, maxHeight: '92vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Pide el PIN de 4 dígitos del trabajador (para checar sin biometría o firmar). */
export function PinPrompt({
  title,
  hint,
  confirmLabel = 'Confirmar',
  busy = false,
  error,
  onSubmit,
  onCancel,
}: {
  title: string;
  hint?: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');
  return (
    <Modal title={title} onClose={onCancel} width={380}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.length === 4) onSubmit(pin);
        }}
      >
        {hint && <p className="muted" style={{ margin: 0 }}>{hint}</p>}
        <label className="field">
          Tu PIN
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            required
            style={{ letterSpacing: '0.4em', fontSize: '1.5rem', textAlign: 'center' }}
          />
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="btn solid block" type="submit" disabled={busy || pin.length < 4}>
          {busy ? 'Un momento…' : confirmLabel}
        </button>
        <button className="btn quiet block" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </form>
    </Modal>
  );
}

/**
 * Lista desplegable con sugerencias y, al final, "Otro (escribir)": si la opción no está,
 * la persona la escribe. El valor es siempre el texto elegido o escrito.
 */
export function SuggestSelect({
  value,
  options,
  onChange,
  placeholder = 'Elige uno',
  otherLabel = 'Otro (escribir)',
  disabled,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder?: string;
  otherLabel?: string;
  disabled?: boolean;
}) {
  const list = options.filter((o, i) => o && o !== 'Otro' && options.indexOf(o) === i);
  const [typing, setTyping] = useState(Boolean(value) && !list.includes(value));
  // Las opciones pueden llegar después (puestos o giros propios de la empresa)
  const key = list.join('|');
  useEffect(() => {
    if (value) setTyping(!list.includes(value));
  }, [value, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const OTHER = '__otro__';
  return (
    <>
      <select
        value={typing ? OTHER : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setTyping(true);
            onChange('');
          } else {
            setTyping(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">{placeholder}</option>
        {list.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={OTHER}>{otherLabel}</option>
      </select>
      {typing && (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Escríbelo aquí" maxLength={80} disabled={disabled} autoFocus />
      )}
    </>
  );
}
