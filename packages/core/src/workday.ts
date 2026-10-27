import type { PunchKind, PunchLike } from './types';

/**
 * Jornada máxima semanal (horas) según la reforma a la LFT publicada el 1 de mayo de 2026.
 * 2026: 48 h · 2027: 46 h · 2028: 44 h · 2029: 42 h · 2030 en adelante: 40 h.
 */
export function weeklyHourLimitForYear(year: number): number {
  if (year <= 2026) return 48;
  if (year === 2027) return 46;
  if (year === 2028) return 44;
  if (year === 2029) return 42;
  return 40;
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona horaria indicada. */
export function localDate(ts: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Lunes (YYYY-MM-DD) de la semana a la que pertenece una fecha local. */
export function weekStart(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export interface Shift {
  /** Fecha local de la entrada; una jornada que cruza medianoche cuenta para el día en que empezó */
  date: string;
  start: Date;
  end: Date | null;
  breakMinutes: number;
  workedMinutes: number;
  /** Jornada sin salida registrada (no suma minutos hasta corregirse) */
  incomplete: boolean;
  /** Comida abierta sin cierre */
  openBreak: boolean;
}

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

/**
 * Agrupa checadas en jornadas: entrada → (comidas) → salida.
 * Las checadas fuera de secuencia se ignoran para el cálculo (quedan en el registro).
 */
export function buildShifts(punches: PunchLike[], timeZone: string): Shift[] {
  const sorted = [...punches].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const shifts: Shift[] = [];
  let current: { start: Date; breakMinutes: number; breakStart: Date | null } | null = null;

  const close = (end: Date | null) => {
    if (!current) return;
    const gross = end ? minutesBetween(current.start, end) : 0;
    let breakMinutes = current.breakMinutes;
    const openBreak = current.breakStart !== null;
    if (openBreak && end && current.breakStart) breakMinutes += minutesBetween(current.breakStart, end);
    shifts.push({
      date: localDate(current.start, timeZone),
      start: current.start,
      end,
      breakMinutes,
      workedMinutes: end ? Math.max(0, gross - breakMinutes) : 0,
      incomplete: end === null,
      openBreak,
    });
    current = null;
  };

  for (const p of sorted) {
    const ts = new Date(p.ts);
    const kind: PunchKind = p.kind;
    if (kind === 'in') {
      if (current) close(null); // entrada sin salida previa
      current = { start: ts, breakMinutes: 0, breakStart: null };
    } else if (!current) {
      continue; // salida o comida sin entrada: se ignora en el cálculo
    } else if (kind === 'break_start') {
      if (!current.breakStart) current.breakStart = ts;
    } else if (kind === 'break_end') {
      if (current.breakStart) {
        current.breakMinutes += minutesBetween(current.breakStart, ts);
        current.breakStart = null;
      }
    } else if (kind === 'out') {
      close(ts);
    }
  }
  if (current) close(null);
  return shifts;
}

export interface WeekSummary {
  weekStart: string;
  limitHours: number;
  workedMinutes: number;
  overtimeMinutes: number;
  remainingMinutes: number;
  /** Porcentaje del tope semanal usado (0–100+) */
  usedPercent: number;
  /** true al rebasar el 90 % del tope */
  nearLimit: boolean;
  incompleteShifts: number;
  days: { date: string; workedMinutes: number; shifts: number }[];
}

/** Resumen semanal (lunes a domingo) con horas extra respecto al tope de la LFT. */
export function summarizeWeeks(shifts: Shift[], options: { limitHours?: number } = {}): WeekSummary[] {
  const byWeek = new Map<string, Shift[]>();
  for (const s of shifts) {
    const w = weekStart(s.date);
    const list = byWeek.get(w) ?? [];
    list.push(s);
    byWeek.set(w, list);
  }

  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, list]) => {
      const limitHours = options.limitHours ?? weeklyHourLimitForYear(Number(week.slice(0, 4)));
      const limit = limitHours * 60;
      const worked = list.reduce((acc, s) => acc + s.workedMinutes, 0);
      const days = new Map<string, { workedMinutes: number; shifts: number }>();
      for (const s of list) {
        const d = days.get(s.date) ?? { workedMinutes: 0, shifts: 0 };
        d.workedMinutes += s.workedMinutes;
        d.shifts += 1;
        days.set(s.date, d);
      }
      return {
        weekStart: week,
        limitHours,
        workedMinutes: worked,
        overtimeMinutes: Math.max(0, worked - limit),
        remainingMinutes: Math.max(0, limit - worked),
        usedPercent: Math.round((worked / limit) * 1000) / 10,
        nearLimit: worked >= limit * 0.9,
        incompleteShifts: list.filter((s) => s.incomplete).length,
        days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
      };
    });
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} h ${m.toString().padStart(2, '0')} min`;
}
