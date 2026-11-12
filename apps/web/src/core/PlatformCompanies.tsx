import { useCallback, useEffect, useState } from 'react';
import { PLAN_LABELS } from '@korporia/core';
import { api, ApiError } from '../lib/api';
import { Modal } from '../common';

interface CompanyRow {
  id: string;
  name: string;
  code: string;
  created_at: string;
  declared_employees: number | null;
  active_employees: number;
  subscription: {
    status: string;
    plan: string;
    employee_limit: number;
    starter_clock_until: string | null;
    starter_hr_until: string | null;
    read_only_at: string | null;
    current_period_end: string | null;
  } | null;
}

const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Plataforma: empresas cliente y alta manual de Jornada mientras no hay cobro con Stripe. */
export function PlatformCompanies() {
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const load = useCallback(() => {
    api<{ companies: CompanyRow[] }>('/api/core/companies')
      .then((r) => setRows(r.companies))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar las empresas.'));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="stack" style={{ marginTop: 24 }}>
      <h2>Empresas</h2>
      {error && <div className="notice error">{error}</div>}
      {!rows ? (
        <p className="muted">Cargando…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Plan</th>
                <th>Colaboradores</th>
                <th>Vigencias</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.name}
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {c.code} · alta {d(c.created_at)}
                    </div>
                  </td>
                  <td>
                    {PLAN_LABELS[c.subscription?.plan ?? ''] ?? c.subscription?.plan ?? '—'}
                    <div className="muted" style={{ fontSize: '0.85rem' }}>{c.subscription?.status}</div>
                  </td>
                  <td>
                    {c.active_employees} de {c.subscription?.employee_limit ?? '—'}
                    {c.declared_employees ? <div className="muted" style={{ fontSize: '0.85rem' }}>declaró {c.declared_employees}</div> : null}
                  </td>
                  <td style={{ fontSize: '0.9rem' }}>
                    {c.subscription?.plan === 'starter' ? (
                      <>
                        Checador {d(c.subscription.starter_clock_until)}
                        <br />
                        RH {d(c.subscription.starter_hr_until)}
                      </>
                    ) : (
                      <>Pagado hasta {d(c.subscription?.current_period_end ?? null)}</>
                    )}
                  </td>
                  <td>
                    <button className="btn small" onClick={() => setEditing(c)}>
                      Plan
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <PlanEditor
          company={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function PlanEditor({ company, onClose, onSaved }: { company: CompanyRow; onClose: () => void; onSaved: () => void }) {
  const [limit, setLimit] = useState(String(Math.max(company.active_employees, company.subscription?.employee_limit ?? 5)));
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/core/companies/${company.id}/plan`, { method: 'PATCH', body });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar.');
      setBusy(false);
    }
  }
  const suspended = company.subscription?.status === 'suspended';
  return (
    <Modal title={`Plan de ${company.name}`} onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Activa Jornada cuando el cliente pague (cobro manual). Quita las vigencias de Korporia Starter: el checador y RH básico vuelven a
          funcionar y la cuenta ya no pasa a solo lectura.
        </p>
        <div className="form-grid">
          <label className="field">
            Colaboradores contratados
            <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </label>
          <label className="field">
            Pagado hasta
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </div>
        {error && <div className="notice error">{error}</div>}
        <button className="btn solid block" disabled={busy || !limit} onClick={() => void send({ plan: 'jornada', employee_limit: Number(limit), period_end: until || null })}>
          Activar Jornada
        </button>
        <button className="btn quiet block" disabled={busy} onClick={() => void send({ status: suspended ? 'active' : 'suspended' })}>
          {suspended ? 'Reactivar cuenta' : 'Suspender cuenta (falta de pago)'}
        </button>
      </div>
    </Modal>
  );
}
