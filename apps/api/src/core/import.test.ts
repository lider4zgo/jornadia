import { describe, expect, it } from 'vitest';
import { plan, type Context } from './import';

const ctx = (over: Partial<Context> = {}): Context => ({
  companyId: 'c1',
  companyCode: 'elaguna',
  employeeLimit: 5,
  activeCount: 3,
  activeModules: new Set(['jornada', 'rh']),
  canRh: true,
  canSchedule: true,
  existing: new Map([
    ['001', { id: 'e1', active: true }],
    ['009', { id: 'e9', active: false }],
  ]),
  sites: new Map([['obra norte', 's1']]),
  departments: new Map([['obra', 'd1']]),
  positions: new Map(),
  schedules: new Map([['oficina', 'h1']]),
  ...over,
});
const rows = (list: Record<string, string>[]) => list.map((row, index) => ({ index, row }));

describe('PLT-11: plan de importación', () => {
  it('nuevas, actualizaciones, bajas y duplicados', () => {
    const p = plan(ctx(), rows([
      { employee_number: '001', full_name: 'Juan Pérez', site: 'OBRA NORTE', schedule: 'oficina' },
      { employee_number: '002', full_name: 'Ana López', department: 'Ventas', position: 'Vendedora' },
      { employee_number: '002', full_name: 'Ana otra vez' },
      { employee_number: '009', full_name: 'Dado de baja' },
    ]));
    expect(p.map((r) => r.action)).toEqual(['update', 'create', 'error', 'error']);
    expect(p[0]).toMatchObject({ employeeId: 'e1', siteId: 's1', scheduleId: 'h1' });
    expect(p[1]!.warnings).toEqual(['Se creará el área "Ventas".', 'Se creará el puesto "Vendedora".']);
    expect(p[2]!.errors[0]).toMatch(/más arriba/);
    expect(p[3]!.errors[0]).toMatch(/dada de baja/);
  });

  it('respeta el límite de colaboradores del plan', () => {
    const p = plan(ctx(), rows(['010', '011', '012'].map((n) => ({ employee_number: n, full_name: `Persona ${n}` }))));
    expect(p.map((r) => r.action)).toEqual(['create', 'create', 'error']);
    expect(p[2]!.errors[0]).toMatch(/5 colaboradores/);
  });

  it('obra u horario desconocidos y sin permisos de RH', () => {
    const p = plan(ctx({ canRh: false, canSchedule: false }), rows([{ employee_number: '020', full_name: 'Luis Gómez', site: 'Obra Sur', schedule: 'Noche', nss: '12345678903' }]));
    expect(p[0]!.action).toBe('create');
    expect(p[0]!.siteId).toBeNull();
    expect(p[0]!.warnings).toHaveLength(3);
  });
});
