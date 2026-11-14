import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { cleanImportRow, simplify, type CleanImportRow, type ImportField, type ImportRow } from '@korporia/core';
import type { AppEnv, AuthContext, Env } from '../env';
import { can, requireAuth, requirePermission, resolveCompany } from '../lib/auth';
import { adminClient, audit, coreDb, jornadaDb, rhDb } from '../lib/supabase';
import { issueActivation } from './worker-access';
import { createWorkerAccount } from './workers';

/**
 * PLT-11: importación de personal desde Excel (Erik, 14 nov 2026). La hoja se lee en el navegador.
 *   POST /api/core/import/preview { rows: ImportRow[] }            qué se crea, qué se actualiza y qué tiene errores
 *   POST /api/core/import/commit  { rows: { index, row }[] }       guarda hasta 10 filas por llamada
 * Si el número de empleado ya existe, la fila actualiza a esa persona; las celdas vacías no borran nada.
 * A cada alta nueva se le genera su código de activación (7 días) para la hoja de accesos.
 */
export const importer = new Hono<AppEnv>();
importer.use('*', requireAuth);

const MAX_PREVIEW = 2000;
const MAX_COMMIT = 10;

type Named = { id: string; name: string };
type PlannedRow = {
  index: number;
  action: 'create' | 'update' | 'error';
  employee_number: string;
  full_name: string;
  errors: string[];
  warnings: string[];
  row: CleanImportRow;
  employeeId: string | null;
  siteId: string | null;
  scheduleId: string | null;
};

export interface Context {
  companyId: string;
  companyCode: string;
  employeeLimit: number;
  activeCount: number;
  activeModules: Set<string>;
  canRh: boolean;
  canSchedule: boolean;
  existing: Map<string, { id: string; active: boolean }>;
  sites: Map<string, string>;
  departments: Map<string, string>;
  positions: Map<string, string>;
  schedules: Map<string, string>;
}

const byName = (rows: Named[] | null) => new Map((rows ?? []).map((r) => [simplify(r.name), r.id]));

async function loadContext(env: Env, auth: AuthContext, companyId: string): Promise<Context> {
  const admin = adminClient(env);
  const core = coreDb(admin);
  const [{ data: company }, { data: subscription }, { data: modules }, { data: employees }, { data: sites }, { data: departments }, { data: positions }, { data: schedules }] =
    await Promise.all([
      core.from('companies').select('code').eq('id', companyId).single(),
      core.from('subscriptions').select('employee_limit').eq('company_id', companyId).single(),
      core.from('company_modules').select('module_key').eq('company_id', companyId).eq('active', true),
      core.from('employees').select('id, employee_number, active').eq('company_id', companyId).limit(10000),
      core.from('sites').select('id, name').eq('company_id', companyId),
      rhDb(admin).from('departments').select('id, name').eq('company_id', companyId).eq('active', true),
      rhDb(admin).from('positions').select('id, name').eq('company_id', companyId).eq('active', true),
      jornadaDb(admin).from('schedules').select('id, name').eq('company_id', companyId).eq('active', true),
    ]);
  if (!company || !subscription) throw new HTTPException(404, { message: 'Empresa no encontrada.' });
  const activeModules = new Set((modules ?? []).map((m) => m.module_key as string));
  return {
    companyId,
    companyCode: company.code,
    employeeLimit: subscription.employee_limit,
    activeCount: (employees ?? []).filter((e) => e.active).length,
    activeModules,
    canRh: activeModules.has('rh') && can(auth, companyId, 'rh.expediente.gestionar'),
    canSchedule: activeModules.has('jornada') && can(auth, companyId, 'jornada.configurar'),
    existing: new Map((employees ?? []).map((e) => [String(e.employee_number).toUpperCase(), { id: e.id, active: e.active }])),
    sites: byName(sites),
    departments: byName(departments),
    positions: byName(positions),
    schedules: byName(schedules),
  };
}

const RH_FIELDS: (keyof CleanImportRow)[] = ['department', 'hired_at', 'national_id', 'tax_id', 'nss', 'daily_salary', 'contract_type', 'contract_end'];

export function plan(ctx: Context, rows: { index: number; row: ImportRow }[]): PlannedRow[] {
  const seen = new Set<string>();
  let capacity = Math.max(0, ctx.employeeLimit - ctx.activeCount);
  return rows.map(({ index, row: raw }) => {
    const { row, errors } = cleanImportRow(raw ?? {});
    const warnings: string[] = [];
    const key = row.employee_number.toUpperCase();
    if (key && seen.has(key)) errors.push('Este número ya aparece más arriba en el archivo.');
    seen.add(key);
    const found = ctx.existing.get(key);
    if (found && !found.active) errors.push('Esta persona está dada de baja; reactívala en Personal antes de importarla.');

    let siteId: string | null = null;
    if (row.site) {
      siteId = ctx.sites.get(simplify(row.site)) ?? null;
      if (!siteId) warnings.push(`La obra "${row.site}" no existe; queda sin obra.`);
    }
    let scheduleId: string | null = null;
    if (row.schedule) {
      if (!ctx.canSchedule) warnings.push('El horario no se guarda (sin Jornada o sin permiso).');
      else {
        scheduleId = ctx.schedules.get(simplify(row.schedule)) ?? null;
        if (!scheduleId) warnings.push(`El horario "${row.schedule}" no existe; queda sin horario.`);
      }
    }
    if (!ctx.canRh && RH_FIELDS.some((f) => row[f] !== undefined)) warnings.push('Los datos del expediente no se guardan (sin RH básico o sin permiso).');
    if (ctx.canRh && row.department && !ctx.departments.has(simplify(row.department))) warnings.push(`Se creará el área "${row.department}".`);
    if (ctx.canRh && row.position && !ctx.positions.has(simplify(row.position))) warnings.push(`Se creará el puesto "${row.position}".`);

    let action: PlannedRow['action'] = errors.length ? 'error' : found ? 'update' : 'create';
    if (action === 'create') {
      if (capacity <= 0) {
        errors.push(`Tu plan permite ${ctx.employeeLimit} colaboradores activos.`);
        action = 'error';
      } else capacity--;
    }
    return { index, action, employee_number: row.employee_number, full_name: row.full_name, errors, warnings, row, employeeId: found?.id ?? null, siteId, scheduleId };
  });
}

function readRows(body: unknown, max: number): { index: number; row: ImportRow }[] {
  const list = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(list) || !list.length) throw new HTTPException(400, { message: 'El archivo no tiene filas.' });
  if (list.length > max) throw new HTTPException(400, { message: `Máximo ${max} filas por archivo.` });
  return list.map((item, i) => {
    const wrapped = item && typeof item === 'object' && 'row' in item ? (item as { index?: unknown; row: unknown }) : { index: i, row: item };
    const row: ImportRow = {};
    for (const [k, v] of Object.entries((wrapped.row ?? {}) as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') row[k as ImportField] = String(v).slice(0, 200);
    }
    return { index: Number.isInteger(wrapped.index) ? Number(wrapped.index) : i, row };
  });
}

importer.post('/preview', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'core.personal.gestionar');
  const ctx = await loadContext(c.env, auth, companyId);
  const planned = plan(ctx, readRows(await c.req.json(), MAX_PREVIEW));
  return c.json({
    rows: planned.map(({ index, action, employee_number, full_name, errors, warnings }) => ({ index, action, employee_number, full_name, errors, warnings })),
    summary: {
      create: planned.filter((r) => r.action === 'create').length,
      update: planned.filter((r) => r.action === 'update').length,
      error: planned.filter((r) => r.action === 'error').length,
      employeeLimit: ctx.employeeLimit,
      activeEmployees: ctx.activeCount,
    },
    saves: { rh: ctx.canRh, schedule: ctx.canSchedule },
  });
});

/** Busca por nombre o crea un área o puesto (una sola vez por nombre). */
async function getOrCreate(env: Env, table: 'departments' | 'positions', cache: Map<string, string>, companyId: string, name: string): Promise<string | null> {
  const key = simplify(name);
  const hit = cache.get(key);
  if (hit) return hit;
  const db = rhDb(adminClient(env));
  const { data, error } = await db.from(table).insert({ company_id: companyId, name }).select('id').single();
  if (data) {
    cache.set(key, data.id);
    return data.id;
  }
  if (error?.code === '23505') {
    const { data: rows } = await db.from(table).select('id, name').eq('company_id', companyId).eq('active', true);
    const again = (rows ?? []).find((r) => simplify(r.name) === key);
    if (again) cache.set(key, again.id);
    return again?.id ?? null;
  }
  console.error(`import ${table} insert failed`, error);
  return null;
}

importer.post('/commit', async (c) => {
  const auth = c.get('auth');
  const companyId = resolveCompany(auth, c.req.header('X-Company-Id'));
  requirePermission(auth, companyId, 'core.personal.gestionar');
  const ctx = await loadContext(c.env, auth, companyId);
  const planned = plan(ctx, readRows(await c.req.json(), MAX_COMMIT));
  const admin = adminClient(c.env);
  const core = coreDb(admin);

  const { data: workerRole } = await core.from('roles').select('id').eq('key', 'worker').is('company_id', null).single();
  if (!workerRole) throw new HTTPException(500, { message: 'No se pudo preparar la importación.' });

  const results: {
    index: number;
    action: 'create' | 'update' | 'error';
    employee_number: string;
    full_name: string;
    error?: string;
    activation?: { code: string; expires_at: string };
  }[] = [];

  for (const p of planned) {
    const base = { index: p.index, employee_number: p.employee_number, full_name: p.full_name };
    if (p.action === 'error') {
      results.push({ ...base, action: 'error', error: p.errors[0] });
      continue;
    }
    try {
      const r = p.row;
      let employeeId = p.employeeId;
      let activation: { code: string; expires_at: string } | undefined;
      if (p.action === 'create') {
        const created = await createWorkerAccount(c.env, {
          actorId: auth.userId,
          companyId,
          companyCode: ctx.companyCode,
          roleId: workerRole.id,
          activeModules: ctx.activeModules,
          worker: { employee_number: r.employee_number, full_name: r.full_name, phone: r.phone ?? null, position: r.position ?? null, default_site_id: p.siteId },
        });
        employeeId = created.employee.id;
        const issued = await issueActivation(c.env, { id: created.employee.id, company_id: companyId, user_id: created.userId });
        activation = { code: issued.code, expires_at: issued.expires };
      } else {
        const patch: Record<string, unknown> = { full_name: r.full_name };
        if (r.phone) patch.phone = r.phone;
        if (r.position) patch.position = r.position;
        if (p.siteId) patch.default_site_id = p.siteId;
        const { error } = await core.from('employees').update(patch).eq('id', employeeId!).eq('company_id', companyId);
        if (error) throw new HTTPException(500, { message: 'No se pudieron guardar los datos básicos.' });
      }

      if (ctx.canRh) {
        const corePatch: Record<string, unknown> = {};
        if (r.national_id) corePatch.national_id = r.national_id;
        if (r.tax_id) corePatch.tax_id = r.tax_id;
        if (r.hired_at) corePatch.hired_at = r.hired_at;
        if (Object.keys(corePatch).length) {
          const { error } = await core.from('employees').update(corePatch).eq('id', employeeId!);
          if (error) throw new HTTPException(500, { message: 'No se pudieron guardar CURP, RFC o fecha de ingreso.' });
        }
        const profile: Record<string, unknown> = {};
        if (r.department) profile.department_id = await getOrCreate(c.env, 'departments', ctx.departments, companyId, r.department);
        if (r.position) profile.position_id = await getOrCreate(c.env, 'positions', ctx.positions, companyId, r.position);
        if (r.nss) profile.nss = r.nss;
        if (r.daily_salary !== undefined) profile.daily_salary = r.daily_salary;
        if (r.contract_type) profile.contract_type = r.contract_type;
        if (r.contract_end) profile.contract_end = r.contract_end;
        if (r.hired_at && p.action === 'create') profile.contract_start = r.hired_at;
        for (const k of Object.keys(profile)) if (profile[k] === null) delete profile[k];
        if (Object.keys(profile).length) {
          const { error } = await rhDb(admin).from('employee_profiles').upsert({ employee_id: employeeId, company_id: companyId, ...profile }, { onConflict: 'employee_id' });
          if (error) {
            console.error('import profile upsert failed', error);
            throw new HTTPException(400, { message: error.code === '23514' ? 'Revisa las fechas del contrato.' : 'No se pudo guardar el expediente.' });
          }
        }
      }
      if (ctx.canSchedule && p.scheduleId) {
        const { error } = await jornadaDb(admin)
          .from('employee_settings')
          .upsert({ employee_id: employeeId, company_id: companyId, schedule_id: p.scheduleId }, { onConflict: 'employee_id' });
        if (error) console.error('import schedule failed', error);
      }
      results.push({ ...base, action: p.action, activation });
      if (p.action === 'create') ctx.activeCount++;
    } catch (err) {
      const message = err instanceof HTTPException ? err.message : 'No se pudo guardar esta fila.';
      if (!(err instanceof HTTPException)) console.error('import row failed', err);
      results.push({ ...base, action: 'error', error: message });
    }
  }

  await audit(c.env, {
    company_id: companyId,
    actor_id: auth.userId,
    action: 'core.personal.imported',
    entity: 'core.employees',
    details: {
      created: results.filter((r) => r.action === 'create').length,
      updated: results.filter((r) => r.action === 'update').length,
      failed: results.filter((r) => r.action === 'error').length,
    },
  });
  // Los códigos de activación solo viajan en esta respuesta (se guardan hasheados)
  return c.json({ results, company_code: ctx.companyCode });
});
