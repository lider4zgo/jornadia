import { describe, expect, it } from 'vitest';
import { decidePunch, parsePunchInput, type PunchContext, type PunchInput } from './punch-rules';

const obra = { id: '11111111-1111-4111-8111-111111111111', name: 'Obra Norte', lat: 25.5428, lng: -103.4068, radius_m: 150, geofence_mode: 'block' as const };

const base: PunchInput = {
  client_uuid: '22222222-2222-4222-8222-222222222222',
  kind: 'in',
  lat: 25.5429,
  lng: -103.4069,
  accuracy_m: 12,
  face_score: 0.82,
  liveness_passed: true,
};

const ctx = (over: Partial<PunchContext> = {}): PunchContext => ({
  sites: [obra],
  lastPunch: null,
  faceThreshold: 0.55,
  hasFaceReference: true,
  consentConfirmed: true,
  now: new Date('2027-01-04T14:00:00Z'),
  ...over,
});

describe('parsePunchInput', () => {
  it('rechaza datos mal formados', () => {
    expect(parsePunchInput(null)).toBeTypeOf('string');
    expect(parsePunchInput({ ...base, client_uuid: 'abc' })).toMatch(/Identificador/);
    expect(parsePunchInput({ ...base, kind: 'lunch' })).toMatch(/Tipo/);
    expect(parsePunchInput({ ...base, lat: 120 })).toMatch(/Coordenadas/);
    expect(parsePunchInput({ ...base, face_score: 3 })).toMatch(/facial/);
  });

  it('normaliza los datos válidos', () => {
    const parsed = parsePunchInput({ ...base, device_ts: '2027-01-04T08:00:00-06:00', extra: 'x' });
    expect(typeof parsed).toBe('object');
    expect((parsed as PunchInput).device_ts).toBe('2027-01-04T14:00:00.000Z');
  });
});

describe('decidePunch', () => {
  it('acepta una entrada válida sin banderas', () => {
    const d = decidePunch(base, ctx());
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.flags).toEqual([]);
      expect(d.faceMatched).toBe(true);
      expect(d.geofence.site?.id).toBe(obra.id);
    }
  });

  it('rechaza en línea fuera de la geocerca y explica la distancia', () => {
    const d = decidePunch({ ...base, lat: 25.56 }, ctx());
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe('geofence');
      expect(d.message).toMatch(/Obra Norte/);
      expect(d.message).toMatch(/\d+ m/);
    }
  });

  it('acepta sin conexión fuera de la geocerca, marcada para revisión', () => {
    const d = decidePunch({ ...base, lat: 25.56, captured_offline: true, device_ts: '2027-01-04T13:00:00.000Z' }, ctx());
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.flags).toEqual(expect.arrayContaining(['outside_geofence', 'captured_offline']));
  });

  it('rechaza una segunda entrada en línea', () => {
    const d = decidePunch(base, ctx({ lastPunch: { kind: 'in', server_ts: '2027-01-04T13:00:00Z', lat: null, lng: null } }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('sequence');
  });

  it('rechaza un rostro que no coincide', () => {
    const d = decidePunch({ ...base, face_score: 0.3 }, ctx());
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('face');
  });

  it('rechaza si la prueba de vida falla', () => {
    const d = decidePunch({ ...base, liveness_passed: false }, ctx());
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe('liveness');
  });

  it('marca falta de referencia facial y de consentimiento sin bloquear', () => {
    const d = decidePunch({ ...base, face_score: null }, ctx({ hasFaceReference: false, consentConfirmed: false }));
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.flags).toEqual(expect.arrayContaining(['no_face_reference', 'consent_missing']));
  });

  it('detecta un salto imposible desde la checada anterior', () => {
    const d = decidePunch(
      { ...base, kind: 'out' },
      ctx({ lastPunch: { kind: 'in', server_ts: '2027-01-04T13:50:00Z', lat: 25.6866, lng: -100.3161 } }),
    );
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.flags).toContain('impossible_jump');
  });

  it('marca sincronización tardía y reloj adelantado', () => {
    const late = decidePunch({ ...base, captured_offline: true, device_ts: '2027-01-02T14:00:00.000Z' }, ctx());
    const ahead = decidePunch({ ...base, captured_offline: true, device_ts: '2027-01-04T15:00:00.000Z' }, ctx());
    expect(late.ok && late.flags.includes('late_sync')).toBe(true);
    expect(ahead.ok && ahead.flags.includes('device_clock_ahead')).toBe(true);
  });
});
