/**
 * JOR-10: horarios de trabajo y reglas de la LFT.
 *   Art. 60: diurna entre las 6:00 y las 20:00; nocturna entre las 20:00 y las 6:00; mixta la que
 *            comprende ambas, siempre que la parte nocturna sea menor de 3 h 30 min (si no, es nocturna).
 *   Art. 61: máximo 8 h la diurna, 7 h la nocturna y 7 h 30 min la mixta.
 *   Art. 59: se pueden repartir las horas de la semana para descansar el sábado (por eso el límite
 *            diario solo se avisa; el semanal depende del año, ver weeklyHourLimitForYear).
 *   Art. 63: media hora de descanso, por lo menos, en la jornada continua.
 *   Art. 69: un día de descanso por cada seis de trabajo.
 * El horario es referencia: no bloquea la checada y el reporte marca lo trabajado fuera de él.
 */

export type ShiftKind = 'diurna' | 'nocturna' | 'mixta';

export interface ScheduleDay {
  /** ISO: 1 = lunes … 7 = domingo */
  weekday: number;
  /** HH:MM (hora local) */
  start: string;
  /** HH:MM; si es menor o igual que la entrada, la salida es al día siguiente */
  end: string;
  breakMinutes: number;
}

export const SHIFT_LABELS: Record<ShiftKind, string> = { diurna: 'Diurna', nocturna: 'Nocturna', mixta: 'Mixta' };
/** Jornada máxima diaria en minutos (art. 61). */
export const DAILY_LIMIT_MINUTES: Record<ShiftKind, number> = { diurna: 480, nocturna: 420, mixta: 450 };
export const WEEKDAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const NIGHT_START = 20 * 60;
const DAY_START = 6 * 60;

export const isValidTime = (v: string) => HM_RE.test(v);

export function toMinutes(hm: string): number {
  const m = HM_RE.exec(hm);
  if (!m) throw new Error(`Hora inválida: ${hm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Inicio y fin del turno en minutos desde la medianoche del día de entrada (el fin puede pasar de 1440). */
export function dayWindow(day: Pick<ScheduleDay, 'start' | 'end'>): { start: number; end: number } {
  const start = toMinutes(day.start);
  let end = toMinutes(day.end);
  if (end <= start) end += 1440;
  return { start, end };
}

/** Minutos del intervalo [start, end) que caen entre las 20:00 y las 6:00. */
export function nightMinutes(start: number, end: number): number {
  let total = 0;
  // Ventanas nocturnas que pueden tocar un turno de hasta 24 h que empieza en el día 0
  const windows: [number, number][] = [
    [-1440 + NIGHT_START, DAY_START],
    [NIGHT_START, 1440 + DAY_START],
    [1440 + NIGHT_START, 2880 + DAY_START],
  ];
  for (const [a, b] of windows) {
    total += Math.max(0, Math.min(end, b) - Math.max(start, a));
  }
  return total;
}

export function classifyShift(day: Pick<ScheduleDay, 'start' | 'end'>): ShiftKind {
  const { start, end } = dayWindow(day);
  const night = nightMinutes(start, end);
  if (night === 0) return 'diurna';
  if (night === end - start || night >= 210) return 'nocturna';
  return 'mixta';
}

/** Minutos de trabajo del día: duración menos la comida. */
export function dayWorkMinutes(day: ScheduleDay): number {
  const { start, end } = dayWindow(day);
  return Math.max(0, end - start - day.breakMinutes);
}

export function weeklyScheduledMinutes(days: ScheduleDay[]): number {
  return days.reduce((a, d) => a + dayWorkMinutes(d), 0);
}

/** Problemas de forma (estos sí impiden guardar). */
export function scheduleErrors(days: ScheduleDay[]): string[] {
  const errors: string[] = [];
  if (!days.length) errors.push('Marca al menos un día de trabajo.');
  const seen = new Set<number>();
  for (const d of days) {
    const label = WEEKDAY_NAMES[d.weekday] ?? 'Un día';
    if (!Number.isInteger(d.weekday) || d.weekday < 1 || d.weekday > 7) errors.push('Día de la semana inválido.');
    else if (seen.has(d.weekday)) errors.push(`${label} aparece dos veces.`);
    seen.add(d.weekday);
    if (!isValidTime(d.start) || !isValidTime(d.end)) {
      errors.push(`${label}: revisa la hora de entrada y de salida.`);
      continue;
    }
    if (d.start === d.end) errors.push(`${label}: la entrada y la salida no pueden ser iguales.`);
    if (!Number.isInteger(d.breakMinutes) || d.breakMinutes < 0 || d.breakMinutes > 240) errors.push(`${label}: la comida debe ser de 0 a 240 minutos.`);
    else if (dayWorkMinutes(d) === 0) errors.push(`${label}: la comida no puede durar todo el turno.`);
  }
  return errors;
}

const fmt = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

function listDays(weekdays: number[]): string {
  const names = weekdays.map((w) => WEEKDAY_NAMES[w] ?? '');
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** Avisos legales (no impiden guardar; Erik, 14 nov 2026). */
export function scheduleWarnings(days: ScheduleDay[], weeklyLimitHours: number): string[] {
  if (scheduleErrors(days).length) return [];
  const warnings: string[] = [];
  // Los días con el mismo aviso se agrupan ("Lunes, Martes y Miércoles: …")
  const daily = new Map<string, number[]>();
  const add = (key: string, weekday: number) => daily.set(key, [...(daily.get(key) ?? []), weekday]);
  for (const d of [...days].sort((a, b) => a.weekday - b.weekday)) {
    const kind = classifyShift(d);
    const work = dayWorkMinutes(d);
    const limit = DAILY_LIMIT_MINUTES[kind];
    if (work > limit) {
      add(
        `${fmt(work)} en jornada ${SHIFT_LABELS[kind].toLowerCase()}; la ley marca un máximo de ${fmt(limit)} (art. 61). Solo se permite si se reparten las horas de la semana para descansar otro día (art. 59).`,
        d.weekday,
      );
    }
    const { start, end } = dayWindow(d);
    if (end - start >= 360 && d.breakMinutes < 30) add('la jornada continua debe tener al menos media hora de descanso (art. 63).', d.weekday);
  }
  for (const [text, weekdays] of daily) warnings.push(`${listDays(weekdays)}: ${text}`);
  const weekly = weeklyScheduledMinutes(days);
  if (weekly > weeklyLimitHours * 60) {
    warnings.push(`La semana suma ${fmt(weekly)}; el tope semanal es de ${weeklyLimitHours} h. Lo que pase del tope cuenta como horas extra.`);
  }
  if (days.length >= 7) warnings.push('No hay día de descanso: la ley pide uno por cada seis días de trabajo (art. 69).');
  return warnings;
}

/** Tipo de jornada del horario: si los días difieren, el más restrictivo (nocturna > mixta > diurna). */
export function scheduleKind(days: ScheduleDay[]): ShiftKind | null {
  const kinds = new Set(days.filter((d) => isValidTime(d.start) && isValidTime(d.end)).map(classifyShift));
  if (!kinds.size) return null;
  if (kinds.has('nocturna')) return 'nocturna';
  if (kinds.has('mixta')) return 'mixta';
  return 'diurna';
}

/** Hora local (minutos desde la medianoche) y fecha local de un instante. */
export function localClock(ts: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ts);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const isoWeekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * Minutos trabajados fuera del horario en una jornada registrada (antes de la entrada o después de
 * la salida del horario). Lo que cabe en la tolerancia no cuenta. Si ese día no tiene horario,
 * `offDay` es verdadero y no se calculan minutos.
 */
export function outsideSchedule(
  shift: { date: string; start: Date; end: Date | null },
  days: ScheduleDay[],
  timeZone: string,
  toleranceMinutes = 0,
): { offDay: boolean; outsideMinutes: number } {
  const day = days.find((d) => d.weekday === isoWeekday(shift.date));
  if (!day) return { offDay: true, outsideMinutes: 0 };
  if (!shift.end) return { offDay: false, outsideMinutes: 0 };
  const startLocal = localClock(shift.start, timeZone).minutes;
  const duration = Math.max(0, Math.round((shift.end.getTime() - shift.start.getTime()) / 60000));
  const endLocal = startLocal + duration;
  const window = dayWindow(day);
  const early = Math.max(0, Math.min(window.start, endLocal) - startLocal);
  const late = Math.max(0, endLocal - Math.max(window.end, startLocal));
  const count = (m: number) => (m > toleranceMinutes ? m : 0);
  return { offDay: false, outsideMinutes: Math.min(duration, count(early) + count(late)) };
}

/** Convierte lo guardado en la base (jsonb) a días válidos; ignora lo que no tenga forma. */
export function parseScheduleDays(raw: unknown): ScheduleDay[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => d as Record<string, unknown>)
    .filter((d) => d && typeof d.start === 'string' && typeof d.end === 'string')
    .map((d) => ({ weekday: Number(d.weekday), start: String(d.start), end: String(d.end), breakMinutes: Number(d.breakMinutes ?? 0) }))
    .filter((d) => Number.isInteger(d.weekday) && d.weekday >= 1 && d.weekday <= 7 && isValidTime(d.start) && isValidTime(d.end))
    .sort((a, b) => a.weekday - b.weekday);
}
