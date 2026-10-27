/** Diferencia (ms) entre la hora local de `tz` y UTC en un instante dado. */
function tzOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - instant;
}

/** Convierte "AAAA-MM-DDTHH:mm" (hora local de `tz`) a ISO UTC. */
export function zonedToIso(local: string, tz: string): string {
  const [date, time = '00:00'] = local.split('T');
  const [y, m, d] = date!.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  return new Date(guess - tzOffsetMs(guess, tz)).toISOString();
}

/** Inicio del día local (ISO UTC) para una fecha AAAA-MM-DD. */
export function startOfLocalDay(date: string, tz: string): string {
  return zonedToIso(`${date}T00:00`, tz);
}
