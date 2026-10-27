import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { buildShifts, localDate, summarizeWeeks, type PunchKind } from '@jornadia/core';
import type { AppEnv } from '../env';
import { requireAuth, requireRole, resolveCompany } from '../auth';
import { adminClient, userClient } from '../supabase';

export const reports = new Hono<AppEnv>();
reports.use('*', requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Reporte de jornada por trabajador y periodo (fechas locales, inclusive).
 *   GET /api/reports/jornada?from=2027-01-04&to=2027-01-10[&employee_id=…][&format=csv]
 * Usa las checadas efectivas (originales + correcciones) y el tope semanal de la LFT.
 */
reports.get('/jornada', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requireRole(auth, companyId, ['owner', 'admin', 'supervisor']);

  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    throw new HTTPException(400, { message: 'Indica un periodo válido (from y to en formato AAAA-MM-DD).' });
  }
  const employeeFilter = c.req.query('employee_id');

  const admin = adminClient(c.env);
  const { data: company } = await admin.from('companies').select('name, timezone, weekly_hour_limit').eq('id', companyId).single();
  if (!company) throw new HTTPException(404, { message: 'Empresa no encontrada.' });

  // Margen de un día a cada lado para cubrir zona horaria y turnos nocturnos; luego se filtra por fecha local
  const db = userClient(c.env, auth.accessToken);
  let q = db
    .from('effective_punches')
    .select('employee_id, kind, ts, source, flags')
    .eq('company_id', companyId)
    .gte('ts', `${addDays(from, -1)}T00:00:00Z`)
    .lt('ts', `${addDays(to, 2)}T00:00:00Z`)
    .order('ts', { ascending: true })
    .limit(20000);
  if (employeeFilter) q = q.eq('employee_id', employeeFilter);
  const [{ data: rows, error }, { data: employees }] = await Promise.all([
    q,
    db.from('employees').select('id, employee_number, full_name, position').eq('company_id', companyId).order('employee_number'),
  ]);
  if (error) throw new HTTPException(500, { message: 'No se pudo generar el reporte.' });

  const tz = company.timezone;
  const byEmployee = new Map<string, { kind: PunchKind; ts: string; source: string; flags: string[] }[]>();
  for (const r of rows ?? []) {
    const list = byEmployee.get(r.employee_id) ?? [];
    list.push(r);
    byEmployee.set(r.employee_id, list);
  }

  const report = (employees ?? [])
    .filter((e) => !employeeFilter || e.id === employeeFilter)
    .map((e) => {
      const punches = byEmployee.get(e.id) ?? [];
      const shifts = buildShifts(punches, tz).filter((s) => s.date >= from && s.date <= to);
      const weeks = summarizeWeeks(shifts, { limitHours: Number(company.weekly_hour_limit) });
      const inRange = punches.filter((p) => {
        const d = localDate(p.ts, tz);
        return d >= from && d <= to;
      });
      return {
        employee: e,
        shifts: shifts.map((s) => ({
          date: s.date,
          start: s.start.toISOString(),
          end: s.end?.toISOString() ?? null,
          breakMinutes: s.breakMinutes,
          workedMinutes: s.workedMinutes,
          incomplete: s.incomplete,
        })),
        weeks,
        totals: {
          workedMinutes: weeks.reduce((a, w) => a + w.workedMinutes, 0),
          overtimeMinutes: weeks.reduce((a, w) => a + w.overtimeMinutes, 0),
          incompleteShifts: weeks.reduce((a, w) => a + w.incompleteShifts, 0),
          correctedPunches: inRange.filter((p) => p.source !== 'original').length,
          flaggedPunches: inRange.filter((p) => (p.flags ?? []).length > 0).length,
        },
      };
    });

  await admin.from('audit_log').insert({
    company_id: companyId,
    actor_id: auth.userId,
    action: 'report.generated',
    entity: 'report',
    details: { from, to, employee_id: employeeFilter ?? null, format: c.req.query('format') ?? 'json' },
  });

  if (c.req.query('format') === 'csv') {
    const fmtTime = (iso: string | null) =>
      iso ? new Intl.DateTimeFormat('es-MX', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '';
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ['Empresa', company.name].map(esc).join(','),
      ['Periodo', `${from} a ${to}`].map(esc).join(','),
      ['Generado', new Date().toISOString()].map(esc).join(','),
      '',
      ['Número', 'Nombre', 'Puesto', 'Fecha', 'Entrada', 'Salida', 'Comida (min)', 'Trabajado (h)', 'Observaciones'].join(','),
    ];
    for (const r of report) {
      for (const s of r.shifts) {
        lines.push(
          [
            r.employee.employee_number,
            r.employee.full_name,
            r.employee.position ?? '',
            s.date,
            fmtTime(s.start),
            fmtTime(s.end),
            s.breakMinutes,
            (s.workedMinutes / 60).toFixed(2),
            s.incomplete ? 'Sin salida registrada' : '',
          ]
            .map(esc)
            .join(','),
        );
      }
    }
    lines.push('', ['Número', 'Nombre', 'Semana (lunes)', 'Trabajado (h)', 'Tope (h)', 'Horas extra (h)'].join(','));
    for (const r of report) {
      for (const w of r.weeks) {
        lines.push(
          [r.employee.employee_number, r.employee.full_name, w.weekStart, (w.workedMinutes / 60).toFixed(2), w.limitHours, (w.overtimeMinutes / 60).toFixed(2)]
            .map(esc)
            .join(','),
        );
      }
    }
    // BOM para que Excel respete acentos
    return new Response('﻿' + lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="jornada_${from}_${to}.csv"`,
      },
    });
  }

  return c.json({ company: { name: company.name, timezone: tz, weeklyHourLimit: Number(company.weekly_hour_limit) }, from, to, report });
});
