// Hora estimada del servidor. El reloj del teléfono puede estar mal o haber
// sido cambiado; guardamos la diferencia medida en la última conexión.
const KEY = 'jornadia-clock-offset';

let offsetMs = Number(localStorage.getItem(KEY) ?? 0) || 0;

/** Registra la hora del servidor recibida en una respuesta (compensa la mitad del viaje). */
export function syncClock(serverIso: string, requestStartedAt: number) {
  const rtt = Date.now() - requestStartedAt;
  const server = Date.parse(serverIso) + rtt / 2;
  if (Number.isNaN(server)) return;
  offsetMs = server - Date.now();
  localStorage.setItem(KEY, String(Math.round(offsetMs)));
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function formatTime(d: Date | string, tz = 'America/Mexico_City', seconds = false): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hour12: false,
  }).format(new Date(d));
}

export function formatDate(d: Date | string, tz = 'America/Mexico_City'): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d));
}
