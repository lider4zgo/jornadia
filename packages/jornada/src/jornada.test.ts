import { describe, expect, it } from 'vitest';
import {
  allowedNextKinds,
  buildShifts,
  distanceMeters,
  evaluateGeofence,
  isImpossibleJump,
  localDate,
  summarizeWeeks,
  transitionError,
  weekStart,
  weeklyHourLimitForYear,
  type Site,
} from './index';

const TZ = 'America/Mexico_City'; // UTC-6 sin horario de verano

const obra: Site = { id: 'norte', name: 'Obra Norte', lat: 25.5428, lng: -103.4068, radius_m: 150, geofence_mode: 'block' };
const obraSur: Site = { id: 'sur', name: 'Obra Sur', lat: 25.51, lng: -103.39, radius_m: 200, geofence_mode: 'flag' };

describe('geocerca', () => {
  it('calcula distancias conocidas', () => {
    // Torreón → Gómez Palacio, ~8–10 km en línea recta
    const d = distanceMeters({ lat: 25.5428, lng: -103.4068 }, { lat: 25.5611, lng: -103.4983 });
    expect(d).toBeGreaterThan(8000);
    expect(d).toBeLessThan(10500);
  });

  it('acepta un punto dentro del radio', () => {
    const r = evaluateGeofence({ lat: 25.5430, lng: -103.4070, accuracy_m: 10 }, [obra]);
    expect(r.inside).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.flags).toEqual([]);
  });

  it('bloquea fuera de una obra en modo "block"', () => {
    const r = evaluateGeofence({ lat: 25.55, lng: -103.4068, accuracy_m: 10 }, [obra]);
    expect(r.inside).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.flags).toContain('outside_geofence');
  });

  it('solo marca fuera de una obra en modo "flag"', () => {
    const r = evaluateGeofence({ lat: 25.52, lng: -103.39, accuracy_m: 10 }, [obraSur]);
    expect(r.inside).toBe(false);
    expect(r.blocked).toBe(false);
  });

  it('concede como máximo 50 m por imprecisión del GPS', () => {
    // ~180 m del centro: fuera de 150 m, dentro de 150 + 50
    const p = { lat: 25.5428 + 180 / 111_320, lng: -103.4068 };
    expect(evaluateGeofence({ ...p, accuracy_m: 40 }, [obra]).inside).toBe(true);
    expect(evaluateGeofence({ ...p, accuracy_m: 5 }, [obra]).inside).toBe(false);
    const lowAcc = evaluateGeofence({ ...p, accuracy_m: 900 }, [obra]);
    expect(lowAcc.inside).toBe(true);
    expect(lowAcc.flags).toContain('gps_low_accuracy');
  });

  it('elige la obra más cercana cuando no se indica una', () => {
    const r = evaluateGeofence({ lat: 25.5101, lng: -103.3901, accuracy_m: 8 }, [obra, obraSur]);
    expect(r.site?.id).toBe('sur');
    expect(r.inside).toBe(true);
  });

  it('sin ubicación bloquea si alguna obra lo exige', () => {
    const r = evaluateGeofence(null, [obra]);
    expect(r.blocked).toBe(true);
    expect(r.flags).toContain('no_location');
  });

  it('detecta saltos imposibles', () => {
    const a = { lat: 25.5428, lng: -103.4068, ts: '2027-01-04T15:00:00Z' };
    const monterrey = { lat: 25.6866, lng: -100.3161, ts: '2027-01-04T15:30:00Z' };
    expect(isImpossibleJump(a, monterrey)).toBe(true);
    expect(isImpossibleJump(a, { ...a, lat: 25.545, ts: '2027-01-04T15:05:00Z' })).toBe(false);
  });
});

describe('secuencia de checadas', () => {
  it('permite las transiciones correctas', () => {
    expect(allowedNextKinds(null)).toEqual(['in']);
    expect(allowedNextKinds('in')).toEqual(['break_start', 'out']);
    expect(allowedNextKinds('break_start')).toEqual(['break_end']);
    expect(allowedNextKinds('out')).toEqual(['in']);
  });

  it('explica por qué una transición no es válida', () => {
    expect(transitionError('in', 'in')).toMatch(/entrada abierta/);
    expect(transitionError('break_start', 'out')).toMatch(/comida/);
    expect(transitionError('in', 'out')).toBeNull();
  });
});

describe('jornada LFT', () => {
  it('aplica el tope semanal escalonado de la reforma', () => {
    expect(weeklyHourLimitForYear(2026)).toBe(48);
    expect(weeklyHourLimitForYear(2027)).toBe(46);
    expect(weeklyHourLimitForYear(2028)).toBe(44);
    expect(weeklyHourLimitForYear(2029)).toBe(42);
    expect(weeklyHourLimitForYear(2031)).toBe(40);
  });

  it('usa la fecha local de México', () => {
    // 23:30 del 4 de enero en Torreón = 05:30 UTC del 5 de enero
    expect(localDate('2027-01-05T05:30:00Z', TZ)).toBe('2027-01-04');
    expect(weekStart('2027-01-10')).toBe('2027-01-04'); // domingo → lunes previo
    expect(weekStart('2027-01-04')).toBe('2027-01-04');
  });

  it('descuenta la comida del tiempo trabajado', () => {
    const shifts = buildShifts(
      [
        { kind: 'in', ts: '2027-01-04T14:00:00Z' }, // 08:00 local
        { kind: 'break_start', ts: '2027-01-04T19:00:00Z' },
        { kind: 'break_end', ts: '2027-01-04T19:45:00Z' },
        { kind: 'out', ts: '2027-01-05T00:00:00Z' }, // 18:00 local
      ],
      TZ,
    );
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.breakMinutes).toBe(45);
    expect(shifts[0]!.workedMinutes).toBe(10 * 60 - 45);
    expect(shifts[0]!.date).toBe('2027-01-04');
  });

  it('asigna un turno nocturno al día en que empezó', () => {
    const shifts = buildShifts(
      [
        { kind: 'in', ts: '2027-01-05T04:00:00Z' }, // 22:00 del día 4
        { kind: 'out', ts: '2027-01-05T12:00:00Z' }, // 06:00 del día 5
      ],
      TZ,
    );
    expect(shifts[0]!.date).toBe('2027-01-04');
    expect(shifts[0]!.workedMinutes).toBe(8 * 60);
  });

  it('marca jornadas sin salida como incompletas sin sumar horas', () => {
    const shifts = buildShifts(
      [
        { kind: 'in', ts: '2027-01-04T14:00:00Z' },
        { kind: 'in', ts: '2027-01-05T14:00:00Z' },
        { kind: 'out', ts: '2027-01-05T22:00:00Z' },
      ],
      TZ,
    );
    expect(shifts).toHaveLength(2);
    expect(shifts[0]!.incomplete).toBe(true);
    expect(shifts[0]!.workedMinutes).toBe(0);
    expect(shifts[1]!.workedMinutes).toBe(8 * 60);
  });

  it('calcula horas extra sobre el tope de 46 h en 2027', () => {
    // 6 días de 8.5 h = 51 h → 5 h extra
    const punches = [4, 5, 6, 7, 8, 9].flatMap((day) => [
      { kind: 'in' as const, ts: `2027-01-${String(day).padStart(2, '0')}T14:00:00Z` },
      { kind: 'out' as const, ts: `2027-01-${String(day).padStart(2, '0')}T22:30:00Z` },
    ]);
    const [week] = summarizeWeeks(buildShifts(punches, TZ));
    expect(week!.weekStart).toBe('2027-01-04');
    expect(week!.limitHours).toBe(46);
    expect(week!.workedMinutes).toBe(51 * 60);
    expect(week!.overtimeMinutes).toBe(5 * 60);
    expect(week!.nearLimit).toBe(true);
    expect(week!.days).toHaveLength(6);
  });
});
