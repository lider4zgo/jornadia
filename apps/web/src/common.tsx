import { useEffect, useState } from 'react';
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
