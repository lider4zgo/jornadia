import { companyDaysBetween } from './calendar';
import { HTTPException } from 'hono/http-exception';
import { leaveDays, vacationBalance, type LeaveKind } from '@korporia/core';
import type { Env } from '../../env';
import { adminClient, coreDb, rhDb } from '../../lib/supabase';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de hoy en la zona horaria de la empresa (AAAA-MM-DD). */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export const EMPLOYEE_COLUMNS = 'id, company_id, user_id, employee_number, full_name, phone, email, national_id, tax_id, position, default_site_id, active, hired_at, terminated_at';
export const PROFILE_COLUMNS =
  'employee_id, department_id, position_id, manager_id, contract_type, sat_regime, contract_start, contract_end, probation_end, daily_salary, birth_date, nss, address, emergency_name, emergency_phone, beneficiaries, rest_days, vacation_days_taken_before, updated_at';
export const LEAVE_COLUMNS =
  'id, employee_id, kind, start_date, end_date, days, reason, status, imss_folio, incapacity_type, document_id, by_employee, decided_at, decision_note, created_at';

export interface EmployeeRow {
  id: string;
  company_id: string;
  user_id: string | null;
  employee_number: string;
  full_name: string;
  hired_at: string | null;
  active: boolean;
  [k: string]: unknown;
}

export async function loadEmployee(env: Env, id: string): Promise<EmployeeRow> {
  const { data } = await coreDb(adminClient(env)).from('employees').select(EMPLOYEE_COLUMNS).eq('id', id).maybeSingle();
  if (!data) throw new HTTPException(404, { message: 'Colaborador no encontrado.' });
  return data as EmployeeRow;
}

export async function selfEmployee(env: Env, companyId: string, userId: string): Promise<EmployeeRow> {
  const { data } = await coreDb(adminClient(env)).from('employees').select(EMPLOYEE_COLUMNS).eq('company_id', companyId).eq('user_id', userId).maybeSingle();
  if (!data) throw new HTTPException(403, { message: 'Tu usuario no está registrado como colaborador.' });
  return data as EmployeeRow;
}

export async function loadProfile(env: Env, employeeId: string) {
  const { data } = await rhDb(adminClient(env)).from('employee_profiles').select(PROFILE_COLUMNS).eq('employee_id', employeeId).maybeSingle();
  return data as (Record<string, unknown> & { rest_days: number[]; vacation_days_taken_before: number }) | null;
}

/** Saldo de vacaciones de ley (null si falta la fecha de ingreso). */
export async function balanceFor(env: Env, employee: EmployeeRow, today: string, takenBefore: number) {
  if (!employee.hired_at) return null;
  const { data: leaves } = await rhDb(adminClient(env))
    .from('leave_requests')
    .select('days, status')
    .eq('employee_id', employee.id)
    .eq('kind', 'vacaciones')
    .in('status', ['aprobada', 'pendiente']);
  const sum = (s: string) => (leaves ?? []).filter((l) => l.status === s).reduce((t, l) => t + Number(l.days), 0);
  return vacationBalance({ hiredAt: employee.hired_at, today, takenBefore: Number(takenBefore ?? 0), approvedDays: sum('aprobada'), pendingDays: sum('pendiente') });
}

/** Valida y cuenta una ausencia; para vacaciones revisa el saldo disponible. */
export async function prepareLeave(
  env: Env,
  employee: EmployeeRow,
  input: { kind: LeaveKind; start: string; end: string },
  opts: { today: string; restDays: number[]; takenBefore: number; excludePending?: number },
): Promise<number> {
  if (!DATE_RE.test(input.start) || !DATE_RE.test(input.end) || input.end < input.start) {
    throw new HTTPException(400, { message: 'Revisa las fechas.' });
  }
  const companyDays = await companyDaysBetween(adminClient(env), employee.company_id, input.start, input.end);
  const days = leaveDays(input.kind, input.start, input.end, opts.restDays, companyDays);
  if (days <= 0) throw new HTTPException(400, { message: 'En esas fechas no hay días laborables.' });

  // No se empalma con otra ausencia vigente del mismo colaborador
  const { data: overlap } = await rhDb(adminClient(env))
    .from('leave_requests')
    .select('id')
    .eq('employee_id', employee.id)
    .in('status', ['pendiente', 'aprobada'])
    .lte('start_date', input.end)
    .gte('end_date', input.start)
    .limit(1);
  if (overlap?.length) throw new HTTPException(409, { message: 'Ya hay una solicitud o ausencia en esas fechas.' });

  if (input.kind === 'vacaciones') {
    const balance = await balanceFor(env, employee, opts.today, opts.takenBefore);
    if (!balance) throw new HTTPException(409, { message: 'Falta la fecha de ingreso del colaborador para calcular sus vacaciones.' });
    const available = balance.available + (opts.excludePending ?? 0);
    if (days > available) {
      throw new HTTPException(409, { message: `Solo hay ${available} día${available === 1 ? '' : 's'} de vacaciones disponibles y la solicitud es de ${days}.` });
    }
  }
  return days;
}

export async function companyTimezone(env: Env, companyId: string): Promise<string> {
  const { data } = await coreDb(adminClient(env)).from('companies').select('timezone').eq('id', companyId).single();
  return data?.timezone ?? 'America/Mexico_City';
}
