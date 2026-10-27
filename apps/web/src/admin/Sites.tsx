import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getPosition, LocationError } from '../lib/geo';
import { supabase } from '../lib/supabase';
import type { Me } from '../types';

interface SiteRow {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  geofence_mode: 'block' | 'flag';
  active: boolean;
}

/** Obras con su geocerca. Lo más práctico: crearla parado en la obra con "Usar mi ubicación". */
export function Sites({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const canEdit = me.role === 'owner' || me.role === 'admin';
  const [list, setList] = useState<SiteRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('sites')
      .select('id, name, address, lat, lng, radius_m, geofence_mode, active')
      .eq('company_id', me.company!.id)
      .order('active', { ascending: false })
      .order('name');
    setList((data ?? []) as SiteRow[]);
  }, [me.company]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(s: SiteRow) {
    const { error: err } = await supabase.from('sites').update({ active: !s.active }).eq('id', s.id);
    if (err) setError('No se pudo actualizar la obra.');
    await load();
    onChanged();
  }

  return (
    <div className="content">
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <h1>Obras</h1>
          <p className="muted">Cada obra tiene un radio. Al checar se registra si el trabajador estaba dentro.</p>
        </div>
        {canEdit && (
          <button className="btn solid" onClick={() => setShowForm(true)}>
            Agregar obra
          </button>
        )}
      </div>
      {error && <div className="notice error">{error}</div>}
      {showForm && (
        <NewSite
          me={me}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            void load();
            onChanged();
          }}
        />
      )}
      {!list ? (
        <p className="muted">Cargando…</p>
      ) : list.length === 0 ? (
        <p className="muted">Aún no hay obras. Sin obras, las checadas se guardan con ubicación pero sin geocerca.</p>
      ) : (
        <div className="list">
          {list.map((s) => (
            <div className="row" key={s.id} style={{ opacity: s.active ? 1 : 0.55 }}>
              <div className="grow">
                <strong>{s.name}</strong>
                <div className="sub">
                  Radio {s.radius_m} m, {s.geofence_mode === 'block' ? 'bloquea fuera del área' : 'solo marca fuera del área'}
                  {s.address ? `. ${s.address}` : ''}
                </div>
              </div>
              <a className="btn small quiet" href={`https://www.google.com/maps?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">
                Ver mapa
              </a>
              {canEdit && (
                <button className="btn small quiet" onClick={() => void toggle(s)}>
                  {s.active ? 'Desactivar' : 'Activar'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewSite({ me, onClose, onCreated }: { me: Me; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('150');
  const [mode, setMode] = useState<'flag' | 'block'>('flag');
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function useMine() {
    setLocating(true);
    setError(null);
    try {
      const p = await getPosition(20000, 15);
      setLat(p.lat.toFixed(6));
      setLng(p.lng.toFixed(6));
    } catch (err) {
      setError(err instanceof LocationError ? err.message : 'No se pudo obtener la ubicación.');
    } finally {
      setLocating(false);
    }
  }

  function pasteCoords(text: string) {
    // Acepta "25.5428, -103.4068" copiado de Google Maps
    const m = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (m) {
      setLat(m[1]!);
      setLng(m[2]!);
      return true;
    }
    return false;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('sites').insert({
      company_id: me.company!.id,
      name: name.trim(),
      address: address.trim() || null,
      lat: Number(lat),
      lng: Number(lng),
      radius_m: Number(radius),
      geofence_mode: mode,
    });
    setBusy(false);
    if (err) setError('No se pudo guardar la obra. Revisa las coordenadas y el radio (20 a 5000 m).');
    else onCreated();
  }

  return (
    <form className="sheet" onSubmit={submit}>
      <h2>Nueva obra</h2>
      <div className="form-grid">
        <label className="field">
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ej. Plaza Galerías, subestación" />
        </label>
        <label className="field">
          Dirección <small>opcional</small>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="field">
          Latitud
          <input
            value={lat}
            onChange={(e) => (pasteCoords(e.target.value) ? null : setLat(e.target.value))}
            inputMode="decimal"
            required
          />
        </label>
        <label className="field">
          Longitud
          <input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" required />
        </label>
        <label className="field">
          Radio (metros)
          <input type="number" min={20} max={5000} value={radius} onChange={(e) => setRadius(e.target.value)} required />
        </label>
        <label className="field">
          Fuera del área
          <select value={mode} onChange={(e) => setMode(e.target.value as 'flag' | 'block')}>
            <option value="flag">Permitir y marcar para revisión</option>
            <option value="block">No permitir checar</option>
          </select>
        </label>
      </div>
      <div className="toolbar">
        <button className="btn small" type="button" onClick={() => void useMine()} disabled={locating}>
          {locating ? 'Buscando señal GPS…' : 'Usar mi ubicación actual'}
        </button>
        <span className="muted" style={{ fontSize: '0.9rem' }}>
          O pega las coordenadas de Google Maps en el campo de latitud.
        </span>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="toolbar">
        <button className="btn solid" type="submit" disabled={busy || !name || !lat || !lng}>
          {busy ? 'Guardando…' : 'Guardar obra'}
        </button>
        <button className="btn quiet" type="button" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
