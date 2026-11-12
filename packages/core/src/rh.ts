/**
 * Reglas de RH básico que comparten la API y la app: vacaciones de ley,
 * días festivos, conteo de días de ausencia y validación de CURP, RFC y NSS.
 */

// ---------------------------------------------------------------------
// Vacaciones (LFT art. 76, reforma "vacaciones dignas" vigente desde 2023)
// ---------------------------------------------------------------------
/** Días de vacaciones que corresponden al cumplir `year` años de servicio (1, 2, 3…). */
export function vacationDaysForYear(year: number): number {
  if (!Number.isInteger(year) || year < 1) return 0;
  if (year <= 5) return 10 + 2 * year;
  return 20 + 2 * Math.ceil((year - 5) / 5);
}

/** Años de servicio cumplidos entre la fecha de ingreso y `today` (fechas AAAA-MM-DD). */
export function completedYears(hiredAt: string, today: string): number {
  const [hy, hm, hd] = hiredAt.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let years = ty - hy;
  if (tm < hm || (tm === hm && td < hd)) years--;
  return Math.max(0, years);
}

/** Próximo aniversario laboral (AAAA-MM-DD) a partir de `today`. */
export function nextAnniversary(hiredAt: string, today: string): string {
  const years = completedYears(hiredAt, today) + 1;
  const [hy, hm, hd] = hiredAt.split('-').map(Number) as [number, number, number];
  const y = hy + years;
  // Quien entró un 29 de febrero cumple el 28 en años no bisiestos
  const lastDay = new Date(Date.UTC(y, hm, 0)).getUTCDate();
  return `${y}-${String(hm).padStart(2, '0')}-${String(Math.min(hd, lastDay)).padStart(2, '0')}`;
}

export interface VacationBalance {
  yearsOfService: number;
  /** Días ganados por todos los aniversarios cumplidos */
  earned: number;
  /** Días disfrutados (antes de Korporia + solicitudes aprobadas) */
  taken: number;
  /** Días en solicitudes pendientes de aprobar */
  pending: number;
  /** Saldo disponible para pedir: ganados − disfrutados − pendientes */
  available: number;
  /** Días que ganará en su próximo aniversario */
  nextYearDays: number;
  nextAnniversary: string;
}

export function vacationBalance(input: {
  hiredAt: string;
  today: string;
  takenBefore: number;
  approvedDays: number;
  pendingDays: number;
}): VacationBalance {
  const years = completedYears(input.hiredAt, input.today);
  let earned = 0;
  for (let y = 1; y <= years; y++) earned += vacationDaysForYear(y);
  const taken = input.takenBefore + input.approvedDays;
  return {
    yearsOfService: years,
    earned,
    taken,
    pending: input.pendingDays,
    available: Math.max(0, earned - taken - input.pendingDays),
    nextYearDays: vacationDaysForYear(years + 1),
    nextAnniversary: nextAnniversary(input.hiredAt, input.today),
  };
}

// ---------------------------------------------------------------------
// Días de descanso obligatorio (LFT art. 74)
// ---------------------------------------------------------------------
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** n-ésimo lunes del mes (n = 1, 2, 3…). */
function nthMonday(year: number, month: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = domingo
  const offset = (8 - first) % 7; // días hasta el primer lunes
  return iso(year, month, 1 + offset + (n - 1) * 7);
}

/**
 * Descansos obligatorios de un año. No incluye los días de jornada electoral,
 * que se agregan cuando los fija la autoridad.
 */
export function mexicanHolidays(year: number): { date: string; name: string }[] {
  const days = [
    { date: iso(year, 1, 1), name: 'Año Nuevo' },
    { date: nthMonday(year, 2, 1), name: 'Día de la Constitución' },
    { date: nthMonday(year, 3, 3), name: 'Natalicio de Benito Juárez' },
    { date: iso(year, 5, 1), name: 'Día del Trabajo' },
    { date: iso(year, 9, 16), name: 'Día de la Independencia' },
    { date: nthMonday(year, 11, 3), name: 'Día de la Revolución' },
    { date: iso(year, 12, 25), name: 'Navidad' },
  ];
  // Transmisión del Poder Ejecutivo Federal (cada seis años: 2024, 2030…)
  if ((year - 2024) % 6 === 0) days.push({ date: iso(year, 10, 1), name: 'Transmisión del Poder Ejecutivo Federal' });
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha AAAA-MM-DD. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Días naturales entre dos fechas, ambas incluidas. */
export function calendarDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Días laborables de una ausencia: excluye los días de descanso semanal del
 * colaborador y los descansos obligatorios. Es lo que descuentan las vacaciones.
 */
export function workingDays(start: string, end: string, restDays: number[] = [7]): number {
  if (end < start) return 0;
  const holidays = new Set<string>();
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    for (const h of mexicanHolidays(y)) holidays.add(h.date);
  }
  let count = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!restDays.includes(isoWeekday(d)) && !holidays.has(d)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------
// Ausencias y documentos
// ---------------------------------------------------------------------
export const LEAVE_KINDS = {
  vacaciones: { label: 'Vacaciones', countsWorkingDays: true, byEmployee: true },
  permiso_con_goce: { label: 'Permiso con goce de sueldo', countsWorkingDays: true, byEmployee: true },
  permiso_sin_goce: { label: 'Permiso sin goce de sueldo', countsWorkingDays: true, byEmployee: true },
  incapacidad: { label: 'Incapacidad del IMSS', countsWorkingDays: false, byEmployee: true },
  maternidad: { label: 'Licencia de maternidad', countsWorkingDays: false, byEmployee: false },
  paternidad: { label: 'Licencia de paternidad', countsWorkingDays: true, byEmployee: false },
  cuidados: { label: 'Licencia por cuidados (LFT art. 170 Bis)', countsWorkingDays: false, byEmployee: false },
} as const;
export type LeaveKind = keyof typeof LEAVE_KINDS;

export const INCAPACITY_TYPES = {
  enfermedad_general: 'Enfermedad general',
  riesgo_trabajo: 'Riesgo de trabajo',
  maternidad: 'Maternidad',
} as const;
export type IncapacityType = keyof typeof INCAPACITY_TYPES;

export const LEAVE_STATUS = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
} as const;

/** Días que cuenta una ausencia según su tipo. */
export function leaveDays(kind: LeaveKind, start: string, end: string, restDays: number[] = [7]): number {
  return LEAVE_KINDS[kind].countsWorkingDays ? workingDays(start, end, restDays) : calendarDays(start, end);
}

export const DOCUMENT_KINDS = {
  ine: 'Identificación oficial (INE)',
  curp: 'CURP',
  rfc: 'Constancia de situación fiscal',
  nss: 'Número de seguridad social',
  domicilio: 'Comprobante de domicilio',
  acta: 'Acta de nacimiento',
  estudios: 'Comprobante de estudios',
  contrato: 'Contrato de trabajo',
  consentimiento: 'Formato firmado (aviso, acuerdo o consentimiento)',
  incapacidad: 'Incapacidad del IMSS',
  licencia: 'Licencia o permiso de conducir',
  certificacion: 'Certificación o constancia (DC-3, etc.)',
  otro: 'Otro documento',
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;

/** Documentos de ingreso que se piden en la alta guiada (ONB). */
export const ONBOARDING_DOCUMENTS: DocumentKind[] = ['ine', 'curp', 'rfc', 'nss', 'domicilio', 'acta'];

export const CONTRACT_TYPES = {
  indeterminado: 'Tiempo indeterminado',
  determinado: 'Tiempo determinado',
  obra: 'Por obra determinada',
  prueba: 'Periodo de prueba',
  capacitacion: 'Capacitación inicial',
} as const;
export type ContractType = keyof typeof CONTRACT_TYPES;

/** Tipos de archivo que se aceptan en el expediente. */
export const DOCUMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// ---------------------------------------------------------------------
// Validación de CURP, RFC y NSS (formato oficial, ONB-07)
// ---------------------------------------------------------------------
const STATES = 'AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE';
const CURP_RE = new RegExp(`^[A-Z][AEIOUX][A-Z]{2}\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])[HMX](${STATES})[B-DF-HJ-NP-TV-Z]{3}[A-Z\\d]\\d$`);

export function isValidCurp(value: string): boolean {
  const curp = value.trim().toUpperCase();
  if (!CURP_RE.test(curp)) return false;
  // Dígito verificador (RENAPO)
  const chars = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += chars.indexOf(curp[i]!) * (18 - i);
  const digit = (10 - (sum % 10)) % 10;
  return digit === Number(curp[17]);
}

/** RFC de persona física (13 caracteres). */
export function isValidRfc(value: string): boolean {
  return /^[A-ZÑ&]{4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z\d]{3}$/.test(value.trim().toUpperCase());
}

/** NSS del IMSS: 11 dígitos con dígito verificador (algoritmo de Luhn). */
export function isValidNss(value: string): boolean {
  const nss = value.replace(/\D/g, '');
  if (nss.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(nss[i]) * (i % 2 === 0 ? 1 : 2);
    if (d > 9) d -= 9;
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(nss[10]);
}
