import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { can, writable } from '../../lib/access';
import type { Me } from '../../types';

export interface Structure {
  departments: { id: string; name: string; active: boolean }[];
  positions: { id: string; name: string; description: string | null; department_id: string | null; active: boolean }[];
  people: { id: string; full_name: string; employee_number: string; position: string | null; department_id: string | null; position_id: string | null; manager_id: string | null }[];
}

type Person = Structure['people'][number];

/** Áreas, puestos y organigrama por jefe directo (ORG). */
export function Organigrama({ me }: { me: Me }) {
  const [s, setS] = useState<Structure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = can(me, 'rh.estructura.gestionar') && writable(me, 'rh');
  const load = useCallback(() => {
    api<Structure>('/api/rh/structure')
      .then(setS)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar.'));
  }, []);
  useEffect(load, [load]);

  if (error) return <div className="notice error">{error}</div>;
  if (!s) return <p className="muted">Cargando…</p>;
  return (
    <div className="stack">
      <h1>Organigrama</h1>
      <Tree s={s} />
      <div className="org-grid">
        <Catalog title="Áreas" kind="departments" items={s.departments} canEdit={canEdit} onChanged={load} />
        <Catalog title="Puestos" kind="positions" items={s.positions} departments={s.departments} canEdit={canEdit} onChanged={load} />
      </div>
    </div>
  );
}

function Tree({ s }: { s: Structure }) {
  const { roots, children } = useMemo(() => {
    const ids = new Set(s.people.map((p) => p.id));
    const children = new Map<string, Person[]>();
    const roots: Person[] = [];
    for (const p of s.people) {
      if (p.manager_id && ids.has(p.manager_id) && p.manager_id !== p.id) {
        children.set(p.manager_id, [...(children.get(p.manager_id) ?? []), p]);
      } else roots.push(p);
    }
    return { roots, children };
  }, [s]);
  const pos = (p: Person) => s.positions.find((x) => x.id === p.position_id)?.name ?? p.position ?? '';
  const dep = (p: Person) => s.departments.find((x) => x.id === p.department_id)?.name ?? '';
  const seen = new Set<string>();
  const render = (p: Person, depth: number): JSX.Element | null => {
    if (seen.has(p.id) || depth > 12) return null; // evita ciclos
    seen.add(p.id);
    const kids = children.get(p.id) ?? [];
    return (
      <li key={p.id}>
        <div className="org-node">
          <strong>{p.full_name}</strong>
          <span>{[pos(p), dep(p)].filter(Boolean).join(' · ') || 'Sin puesto'}</span>
        </div>
        {kids.length > 0 && <ul>{kids.map((k) => render(k, depth + 1))}</ul>}
      </li>
    );
  };
  if (s.people.length === 0) return <p className="muted">Aún no hay colaboradores activos.</p>;
  // Primero quienes tienen equipo a su cargo
  const ordered = [...roots].sort((a, b) => (children.get(b.id)?.length ?? 0) - (children.get(a.id)?.length ?? 0));
  return (
    <section className="sheet">
      <ul className="org-tree">{ordered.map((r) => render(r, 0))}</ul>
      <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.85rem' }}>El jefe directo, el puesto y el área se asignan en el expediente de cada colaborador.</p>
    </section>
  );
}

function Catalog({
  title,
  kind,
  items,
  departments,
  canEdit,
  onChanged,
}: {
  title: string;
  kind: 'departments' | 'positions';
  items: { id: string; name: string; active: boolean; description?: string | null; department_id?: string | null }[];
  departments?: Structure['departments'];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [dep, setDep] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/rh/${kind}`, { body: kind === 'positions' ? { name, department_id: dep || null } : { name } });
      setName('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar.');
    }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`/api/rh/${kind}/${id}`, { method: 'PATCH', body });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar.');
    }
  }
  return (
    <section className="sheet stack">
      <h2>{title}</h2>
      <div className="list">
        {items.length === 0 && <p className="muted">Sin {title.toLowerCase()}.</p>}
        {items.map((i) => (
          <div className="row" key={i.id} style={{ opacity: i.active ? 1 : 0.5 }}>
            <div className="grow">
              <div>{i.name}</div>
              {kind === 'positions' && <div className="sub">{departments?.find((d) => d.id === i.department_id)?.name ?? 'Sin área'}</div>}
            </div>
            {canEdit && (
              <>
                <button
                  className="btn small quiet"
                  onClick={() => {
                    const next = prompt('Nuevo nombre', i.name);
                    if (next && next.trim() !== i.name) void patch(i.id, { name: next });
                  }}
                >
                  Renombrar
                </button>
                <button className="btn small quiet" onClick={() => void patch(i.id, { active: !i.active })}>
                  {i.active ? 'Desactivar' : 'Activar'}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <form className="toolbar" onSubmit={add}>
          <label className="field" style={{ flex: 1 }}>
            <span className="sr-only">Nombre</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'positions' ? 'Ej. Oficial electricista' : 'Ej. Obra, Administración'} required />
          </label>
          {kind === 'positions' && (
            <select value={dep} onChange={(e) => setDep(e.target.value)} aria-label="Área del puesto">
              <option value="">Sin área</option>
              {departments?.filter((d) => d.active).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn solid">Agregar</button>
        </form>
      )}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}
