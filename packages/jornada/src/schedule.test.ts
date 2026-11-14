import { describe, expect, it } from 'vitest';
import { classifyShift, dayWorkMinutes, outsideSchedule, parseScheduleDays, scheduleErrors, scheduleKind, scheduleWarnings, type ScheduleDay } from './schedule';

const TZ = 'America/Mexico_City';
const week = (start: string, end: string, breakMinutes = 60, days = [1, 2, 3, 4, 5]): ScheduleDay[] =>
  days.map((weekday) => ({ weekday, start, end, breakMinutes }));

describe('JOR-10 horarios (LFT arts. 60, 61, 63, 69)', () => {
  it('clasifica diurna, nocturna y mixta', () => {
    expect(classifyShift({ start: '09:00', end: '18:00' })).toBe('diurna');
    expect(classifyShift({ start: '22:00', end: '05:00' })).toBe('nocturna');
    expect(classifyShift({ start: '14:00', end: '22:00' })).toBe('mixta'); // 2 h nocturnas
    expect(classifyShift({ start: '16:00', end: '23:30' })).toBe('nocturna'); // 3.5 h nocturnas
    expect(classifyShift({ start: '05:00', end: '12:00' })).toBe('mixta'); // 1 h nocturna
  });

  it('descuenta la comida y cruza medianoche', () => {
    expect(dayWorkMinutes({ weekday: 1, start: '09:00', end: '18:00', breakMinutes: 60 })).toBe(480);
    expect(dayWorkMinutes({ weekday: 1, start: '22:00', end: '05:00', breakMinutes: 0 })).toBe(420);
  });

  it('valida la forma', () => {
    expect(scheduleErrors([])).toHaveLength(1);
    expect(scheduleErrors(week('09:00', '09:00'))).not.toHaveLength(0);
    expect(scheduleErrors([...week('09:00', '18:00'), { weekday: 1, start: '09:00', end: '14:00', breakMinutes: 0 }])).toContain('Lunes aparece dos veces.');
    expect(scheduleErrors(week('09:00', '18:00'))).toEqual([]);
  });

  it('solo avisa al pasar los límites', () => {
    expect(scheduleWarnings(week('09:00', '18:00'), 48)).toEqual([]);
    // L–V de 9 h efectivas: avisa por día (art. 61) pero suma 45 h, dentro del tope
    const long = scheduleWarnings(week('08:00', '18:00'), 48);
    expect(long).toHaveLength(1);
    expect(long[0]).toMatch(/^Lunes, Martes, Miércoles, Jueves y Viernes: 9 h .*art\. 61/);
    // L–S de 8 h = 48 h: en 2027 (46 h) avisa por la semana
    expect(scheduleWarnings(week('09:00', '18:00', 60, [1, 2, 3, 4, 5, 6]), 46).some((w) => w.includes('tope semanal'))).toBe(true);
    expect(scheduleWarnings(week('09:00', '17:00', 0, [1, 2, 3, 4, 5, 6, 7]), 48).some((w) => w.includes('art. 63'))).toBe(true);
    expect(scheduleWarnings(week('09:00', '13:00', 0, [1, 2, 3, 4, 5, 6, 7]), 48).some((w) => w.includes('art. 69'))).toBe(true);
  });

  it('tipo del horario: el más restrictivo', () => {
    expect(scheduleKind([...week('09:00', '18:00'), { weekday: 6, start: '22:00', end: '05:00', breakMinutes: 0 }])).toBe('nocturna');
  });

  it('minutos fuera del horario con tolerancia', () => {
    const days = week('09:00', '18:00');
    // Lunes 4 ene 2027: 8:30 a 19:00 hora de CDMX (UTC-6)
    const shift = { date: '2027-01-04', start: new Date('2027-01-04T14:30:00Z'), end: new Date('2027-01-05T01:00:00Z') };
    expect(outsideSchedule(shift, days, TZ, 10)).toEqual({ offDay: false, outsideMinutes: 90 });
    // 8:55 a 18:05 cabe en la tolerancia
    expect(outsideSchedule({ date: '2027-01-04', start: new Date('2027-01-04T14:55:00Z'), end: new Date('2027-01-05T00:05:00Z') }, days, TZ, 10).outsideMinutes).toBe(0);
    // Sábado sin horario
    expect(outsideSchedule({ date: '2027-01-09', start: new Date('2027-01-09T15:00:00Z'), end: new Date('2027-01-09T20:00:00Z') }, days, TZ).offDay).toBe(true);
    // Nocturno 22:00–05:00, salida 06:00
    const night = week('22:00', '05:00', 0);
    expect(outsideSchedule({ date: '2027-01-04', start: new Date('2027-01-05T04:00:00Z'), end: new Date('2027-01-05T12:00:00Z') }, night, TZ).outsideMinutes).toBe(60);
  });

  it('lee lo guardado en la base', () => {
    expect(parseScheduleDays([{ weekday: 2, start: '09:00', end: '14:00', breakMinutes: 0 }, { weekday: 9 }, 'x'])).toHaveLength(1);
    expect(parseScheduleDays(null)).toEqual([]);
  });
});
