import { describe, expect, it } from 'vitest';
import { cleanImportRow, contractTypeFrom, importDate, matchImportHeaders, readImportRow } from './importing';

describe('PLT-11 importación de personal', () => {
  it('reconoce encabezados con y sin acentos', () => {
    const { columns, ignored } = matchImportHeaders(['No.', 'Nombre', 'Área', 'TELEFONO', 'Sueldo diario', 'Comentarios', 'curp']);
    expect(columns).toMatchObject({ employee_number: 0, full_name: 1, department: 2, phone: 3, daily_salary: 4, national_id: 6 });
    expect(ignored).toEqual(['Comentarios']);
  });

  it('entiende fechas de Excel y de texto', () => {
    expect(importDate(new Date(Date.UTC(2024, 2, 15)))).toBe('2024-03-15');
    expect(importDate('15/03/2024')).toBe('2024-03-15');
    expect(importDate('5-1-24')).toBe('2024-01-05');
    expect(importDate('2024-03-15')).toBe('2024-03-15');
    expect(importDate('31/02/2024')).toBe('');
  });

  it('lee filas con números y fechas', () => {
    const { columns } = matchImportHeaders(['Número de empleado', 'Nombre completo', 'Fecha de ingreso', 'Celular']);
    expect(readImportRow([15, 'Ana López', new Date(Date.UTC(2023, 0, 9)), 8711234567], columns)).toEqual({
      employee_number: '15',
      full_name: 'Ana López',
      hired_at: '2023-01-09',
      phone: '8711234567',
    });
  });

  it('valida y limpia', () => {
    const ok = cleanImportRow({ employee_number: '001', full_name: ' Juan  Pérez ', phone: '+52 871 123 4567', daily_salary: '$1,250.50', contract_type: 'Tiempo indeterminado', nss: '1234567890' });
    expect(ok.errors).toEqual(ok.errors.filter((e) => e.includes('NSS')));
    expect(ok.row).toMatchObject({ full_name: 'Juan Pérez', phone: '8711234567', daily_salary: 1250.5, contract_type: 'indeterminado' });
    const bad = cleanImportRow({ employee_number: 'A 1', full_name: '', phone: '123', national_id: 'XXXX' });
    expect(bad.errors).toHaveLength(4);
  });

  it('tipo de contrato flexible', () => {
    expect(contractTypeFrom('Eventual')).toBe('determinado');
    expect(contractTypeFrom('por obra determinada')).toBe('obra');
    expect(contractTypeFrom('Capacitación inicial')).toBe('capacitacion');
    expect(contractTypeFrom('honorarios')).toBeNull();
  });
});
