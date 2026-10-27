import { useEffect, useState } from 'react';
import { serverNow } from './lib/clock';

export function Mark({ className = 'mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#12305A" />
      <path d="M256 84c-82 0-148 64-148 144 0 104 148 216 148 216s148-112 148-216c0-80-66-144-148-144z" fill="#F5F7FA" />
      <circle cx="256" cy="228" r="86" fill="#12305A" />
      <path d="M256 168v64l42 26" fill="none" stroke="#F2600C" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
          fill="#17803D"
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
