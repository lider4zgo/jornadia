import { CONTRACT_TYPES, isValidCurp, isValidNss, isValidRfc, type ContractType } from './rh';

/**
 * PLT-11: importación de personal desde Excel (Erik, 14 nov 2026).
 * Solo número y nombre son obligatorios. Si el número ya existe, la fila actualiza a esa persona.
 * Las celdas vacías no borran lo que ya está guardado.
 */
export type ImportField =
  | 'employee_number'
  | 'full_name'
  | 'position'
  | 'phone'
  | 'site'
  | 'department'
  | 'schedule'
  | 'hired_at'
  | 'national_id'
  | 'tax_id'
  | 'nss'
  | 'daily_salary'
  | 'contract_type'
  | 'contract_end';

export interface ImportColumn {
  field: ImportField;
  title: string;
  /** Otros encabezados que se reconocen (sin acentos, en minúsculas) */
  aliases: string[];
  example: string;
  help: string;
  required?: boolean;
  /** Módulo que guarda el dato (sin él, la columna se ignora) */
  module?: 'rh' | 'jornada';
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'employee_number', title: 'Número de empleado', aliases: ['numero', 'num', 'no', 'no empleado', 'numero empleado', 'clave', 'id'], example: '001', help: 'Obligatorio. Letras, números o guion; es con lo que entra a checar.', required: true },
  { field: 'full_name', title: 'Nombre completo', aliases: ['nombre', 'empleado', 'trabajador', 'colaborador'], example: 'Juan Pérez López', help: 'Obligatorio.', required: true },
  { field: 'position', title: 'Puesto', aliases: ['cargo', 'puesto de trabajo'], example: 'Oficial electricista', help: 'Si no existe, se crea.' },
  { field: 'phone', title: 'Celular', aliases: ['telefono', 'tel', 'movil', 'whatsapp', 'celular (10 digitos)'], example: '8711234567', help: '10 dígitos.' },
  { field: 'department', title: 'Área', aliases: ['area', 'departamento', 'depto'], example: 'Obra', help: 'Si no existe, se crea.', module: 'rh' },
  { field: 'site', title: 'Obra', aliases: ['sucursal', 'sitio', 'centro de trabajo', 'ubicacion'], example: 'Obra Norte', help: 'Debe existir en Obras.' },
  { field: 'schedule', title: 'Horario', aliases: ['turno'], example: 'Oficina', help: 'Debe existir en Jornada → Horarios.', module: 'jornada' },
  { field: 'hired_at', title: 'Fecha de ingreso', aliases: ['ingreso', 'fecha ingreso', 'alta', 'fecha de alta', 'antiguedad'], example: '15/03/2024', help: 'dd/mm/aaaa.', module: 'rh' },
  { field: 'national_id', title: 'CURP', aliases: [], example: '', help: '18 caracteres.', module: 'rh' },
  { field: 'tax_id', title: 'RFC', aliases: [], example: '', help: '13 caracteres.', module: 'rh' },
  { field: 'nss', title: 'NSS', aliases: ['numero de seguro social', 'imss', 'seguro social'], example: '', help: '11 dígitos.', module: 'rh' },
  { field: 'daily_salary', title: 'Salario diario', aliases: ['sueldo diario', 'salario', 'sueldo', 'sd'], example: '450', help: 'En pesos, sin signo.', module: 'rh' },
  { field: 'contract_type', title: 'Tipo de contrato', aliases: ['contrato', 'tipo contrato'], example: 'Indeterminado', help: 'Indeterminado, determinado, obra, prueba o capacitación.', module: 'rh' },
  { field: 'contract_end', title: 'Fin de contrato', aliases: ['vencimiento', 'fin contrato', 'termino de contrato'], example: '', help: 'dd/mm/aaaa (solo contratos con fecha de término).', module: 'rh' },
];

/** Texto sin acentos, en minúsculas y con espacios simples (para comparar encabezados y nombres). */
export function simplify(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[._:*#°]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ubica cada columna conocida en la fila de encabezados; las desconocidas se ignoran. */
export function matchImportHeaders(headers: unknown[]): { columns: Partial<Record<ImportField, number>>; ignored: string[] } {
  const columns: Partial<Record<ImportField, number>> = {};
  const ignored: string[] = [];
  headers.forEach((h, i) => {
    const key = simplify(h);
    if (!key) return;
    const col = IMPORT_COLUMNS.find((c) => simplify(c.title) === key || c.aliases.includes(key));
    if (col && columns[col.field] === undefined) columns[col.field] = i;
    else ignored.push(String(h));
  });
  return { columns, ignored };
}

export type ImportRow = Partial<Record<ImportField, string>>;

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha de una celda (Date de Excel, dd/mm/aaaa, d-m-aa o aaaa-mm-dd) a AAAA-MM-DD; '' si no se entiende. */
export function importDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const s = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! - (+m[3]! > 50 ? 100 : 0) : +m[3]!;
    return valid(y, +m[2]!, +m[1]!);
  }
  return '';
}
function valid(y: number, mo: number, d: number): string {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2100) return '';
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Lee una fila de la hoja con las columnas ubicadas; números y fechas pasan a texto. */
export function readImportRow(cells: unknown[], columns: Partial<Record<ImportField, number>>): ImportRow {
  const row: ImportRow = {};
  for (const [field, index] of Object.entries(columns) as [ImportField, number][]) {
    const raw = cells[index];
    if (raw == null || raw === '') continue;
    let v: string;
    if (field === 'hired_at' || field === 'contract_end') v = importDate(raw) || String(raw).trim();
    else if (raw instanceof Date) v = importDate(raw);
    else if (typeof raw === 'number') v = String(raw);
    else v = String(raw).trim();
    if (v) row[field] = v;
  }
  return row;
}

export function contractTypeFrom(value: string): ContractType | null {
  const s = simplify(value);
  if (!s) return null;
  for (const [key, label] of Object.entries(CONTRACT_TYPES) as [ContractType, string][]) {
    if (s === key || s === simplify(label)) return key;
  }
  if (s.includes('indeterminad') || s === 'planta' || s === 'base') return 'indeterminado';
  if (s.includes('determinad') || s.includes('temporal') || s.includes('eventual')) return 'determinado';
  if (s.includes('obra')) return 'obra';
  if (s.includes('prueba')) return 'prueba';
  if (s.includes('capacita')) return 'capacitacion';
  return null;
}

export interface CleanImportRow {
  employee_number: string;
  full_name: string;
  position?: string;
  phone?: string;
  site?: string;
  department?: string;
  schedule?: string;
  hired_at?: string;
  national_id?: string;
  tax_id?: string;
  nss?: string;
  daily_salary?: number;
  contract_type?: ContractType;
  contract_end?: string;
}

/** Valida y limpia una fila. Los errores impiden guardarla; el resto de la hoja sí se guarda. */
export function cleanImportRow(row: ImportRow): { row: CleanImportRow; errors: string[] } {
  const errors: string[] = [];
  const text = (v: string | undefined, max: number) => (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const number = text(row.employee_number, 20).replace(/\.0+$/, '');
  const clean: CleanImportRow = { employee_number: number, full_name: text(row.full_name, 120) };
  if (!number) errors.push('Falta el número de empleado.');
  else if (!/^[A-Za-z0-9-]+$/.test(number)) errors.push('El número de empleado solo admite letras, números y guion.');
  if (clean.full_name.length < 3) errors.push('Falta el nombre completo.');

  for (const f of ['position', 'site', 'department', 'schedule'] as const) {
    const v = text(row[f], 80);
    if (v) clean[f] = v;
  }
  if (row.phone) {
    const digits = row.phone.replace(/\D/g, '').replace(/^52(?=\d{10}$)/, '');
    if (digits.length !== 10) errors.push('El celular debe tener 10 dígitos.');
    else clean.phone = digits;
  }
  for (const f of ['hired_at', 'contract_end'] as const) {
    if (!row[f]) continue;
    const d = importDate(row[f]);
    if (!d) errors.push(`Revisa la ${f === 'hired_at' ? 'fecha de ingreso' : 'fecha de fin de contrato'} (dd/mm/aaaa).`);
    else clean[f] = d;
  }
  if (row.national_id) {
    const v = row.national_id.trim().toUpperCase();
    if (!isValidCurp(v)) errors.push('La CURP no es válida.');
    else clean.national_id = v;
  }
  if (row.tax_id) {
    const v = row.tax_id.trim().toUpperCase().replace(/[\s-]/g, '');
    if (!isValidRfc(v)) errors.push('El RFC no es válido (persona física, 13 caracteres).');
    else clean.tax_id = v;
  }
  if (row.nss) {
    const v = row.nss.replace(/\D/g, '').padStart(11, '0');
    if (!isValidNss(v)) errors.push('El NSS no es válido (11 dígitos).');
    else clean.nss = v;
  }
  if (row.daily_salary) {
    const v = Number(row.daily_salary.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(v) || v < 0 || v > 100000) errors.push('Revisa el salario diario.');
    else clean.daily_salary = Math.round(v * 100) / 100;
  }
  if (row.contract_type) {
    const v = contractTypeFrom(row.contract_type);
    if (!v) errors.push('Tipo de contrato desconocido (indeterminado, determinado, obra, prueba o capacitación).');
    else clean.contract_type = v;
  }
  if (clean.contract_end && clean.hired_at && clean.contract_end < clean.hired_at) errors.push('El fin de contrato es antes de la fecha de ingreso.');
  return { row: clean, errors };
}
