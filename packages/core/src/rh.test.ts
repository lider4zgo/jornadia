import { describe, expect, it } from 'vitest';
import {
  calendarDays,
  isValidCompanyRfc,
  normalizeOrigin,
  completedYears,
  isValidCurp,
  isValidNss,
  isValidRfc,
  leaveDays,
  mexicanHolidays,
  nextAnniversary,
  vacationBalance,
  vacationDaysForYear,
  workingDays,
} from './rh';
import { biometricConsent, docToText, fullNotice, journeyAgreement, simplifiedNotice, workerDocVersion } from './worker-docs';

describe('vacaciones dignas (LFT art. 76)', () => {
  it('sigue la tabla de la ley', () => {
    expect([1, 2, 3, 4, 5].map(vacationDaysForYear)).toEqual([12, 14, 16, 18, 20]);
    expect([6, 10, 11, 15, 16, 20, 21, 25, 26].map(vacationDaysForYear)).toEqual([22, 22, 24, 24, 26, 26, 28, 28, 30]);
    expect(vacationDaysForYear(0)).toBe(0);
  });

  it('cuenta años cumplidos y el próximo aniversario', () => {
    expect(completedYears('2024-03-15', '2026-03-14')).toBe(1);
    expect(completedYears('2024-03-15', '2026-03-15')).toBe(2);
    expect(nextAnniversary('2024-02-29', '2026-03-01')).toBe('2027-02-28');
  });

  it('calcula el saldo con lo disfrutado y lo pendiente', () => {
    const b = vacationBalance({ hiredAt: '2023-01-10', today: '2026-11-12', takenBefore: 10, approvedDays: 6, pendingDays: 3 });
    expect(b.yearsOfService).toBe(3);
    expect(b.earned).toBe(12 + 14 + 16);
    expect(b.available).toBe(42 - 16 - 3);
    expect(b.nextYearDays).toBe(18);
  });
});

describe('días de ausencia', () => {
  it('conoce los descansos obligatorios', () => {
    const y2027 = mexicanHolidays(2027).map((h) => h.date);
    expect(y2027).toEqual(['2027-01-01', '2027-02-01', '2027-03-15', '2027-05-01', '2027-09-16', '2027-11-15', '2027-12-25']);
    expect(mexicanHolidays(2030).some((h) => h.date === '2030-10-01')).toBe(true);
  });

  it('las vacaciones no cuentan descansos ni festivos', () => {
    // Lunes 14 a domingo 20 de marzo de 2027; el 15 es festivo y el domingo descanso
    expect(workingDays('2027-03-14', '2027-03-20')).toBe(5);
    expect(workingDays('2027-03-14', '2027-03-20', [6, 7])).toBe(4);
    expect(leaveDays('vacaciones', '2027-03-14', '2027-03-20')).toBe(5);
  });

  it('las incapacidades cuentan días naturales', () => {
    expect(calendarDays('2027-01-30', '2027-02-02')).toBe(4);
    expect(leaveDays('incapacidad', '2027-03-14', '2027-03-20')).toBe(7);
  });
});

describe('validación de identificadores', () => {
  it('CURP con dígito verificador', () => {
    expect(isValidCurp('HEGG560427MVZRRL04')).toBe(true);
    expect(isValidCurp('HEGG560427MVZRRL05')).toBe(false);
    expect(isValidCurp('HEGG561327MVZRRL04')).toBe(false);
  });
  it('RFC de persona física', () => {
    expect(isValidRfc('MACE880618E65')).toBe(true);
    expect(isValidRfc('MACE881318E65')).toBe(false);
  });
  it('NSS con dígito verificador', () => {
    expect(isValidNss('12345678903')).toBe(true);
    expect(isValidNss('12345678904')).toBe(false);
    expect(isValidNss('123')).toBe(false);
  });
});

describe('documentos del trabajador', () => {
  const ctx = {
    companyName: 'Eléctrica Laguna',
    employeeName: 'Juan Pérez',
    employeeNumber: '001',
    privacyEmail: 'privacidad@electricalaguna.mx',
    usesRecords: true,
    usesPayroll: false,
  };
  it('la versión del aviso cambia con el expediente', () => {
    expect(workerDocVersion('aviso_trabajadores', { usesRecords: false, usesPayroll: false })).toBe('2026-11-06');
    expect(workerDocVersion('aviso_trabajadores', ctx)).toBe('2026-11-06+expediente');
  });
  it('arma los textos con los datos del patrón y del trabajador', () => {
    const text = [simplifiedNotice(ctx), fullNotice(ctx), journeyAgreement(ctx), biometricConsent(ctx)].map(docToText).join('\n');
    expect(text).toContain('Juan Pérez');
    expect(text).toContain('privacidad@electricalaguna.mx');
    expect(text).toContain('expediente');
    expect(text).not.toContain('nómina, timbrar');
    expect(text).not.toContain('[');
  });
});

describe('bloque 1 de la apertura', () => {
  it('acepta RFC de persona moral y física para la empresa', () => {
    expect(isValidCompanyRfc('ABC010203XY1')).toBe(true);
    expect(isValidCompanyRfc('MACE880618E65')).toBe(true);
    expect(isValidCompanyRfc('AB010203XY1')).toBe(false);
  });
  it('normaliza el origen del registro', () => {
    expect(normalizeOrigin(' Guia-Reforma ')).toBe('guia-reforma');
    expect(normalizeOrigin('d-pérez')).toBe('d-prez');
    expect(normalizeOrigin('x')).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });
  it('los días de descanso de la empresa no cuentan como vacaciones', () => {
    // lunes 10 a viernes 14 de mayo de 2027; el 10 lo descansa la empresa
    expect(workingDays('2027-05-10', '2027-05-14', [6, 7])).toBe(5);
    expect(workingDays('2027-05-10', '2027-05-14', [6, 7], ['2027-05-10'])).toBe(4);
  });
});
