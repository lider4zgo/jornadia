import { useState } from 'react';
import { DOCUMENT_KINDS, LEAVE_KINDS, LEAVE_STATUS, type DocumentKind } from '@korporia/core';
import { api, ApiError, fetchBlobUrl } from '../../lib/api';

export interface StoredDocument {
  id: string;
  employee_id: string;
  kind: DocumentKind;
  name: string;
  mime: string;
  size_bytes: number;
  expires_on: string | null;
  by_employee: boolean;
  created_at: string;
}

export interface Leave {
  id: string;
  employee_id: string;
  kind: keyof typeof LEAVE_KINDS;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: keyof typeof LEAVE_STATUS;
  imss_folio: string | null;
  incapacity_type: string | null;
  by_employee: boolean;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  employee?: { full_name: string; employee_number: string } | null;
}

export interface Balance {
  yearsOfService: number;
  earned: number;
  taken: number;
  pending: number;
  available: number;
  nextYearDays: number;
  nextAnniversary: string;
}

export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** 2027-01-04 → 4 ene 2027 */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function LeaveStatusChip({ status }: { status: Leave['status'] }) {
  const cls = status === 'aprobada' ? 'go' : status === 'pendiente' ? 'warn' : status === 'rechazada' ? 'stop' : '';
  return <span className={`chip ${cls}`}>{LEAVE_STATUS[status]}</span>;
}

export function leaveLabel(l: Pick<Leave, 'kind' | 'days'>) {
  return `${LEAVE_KINDS[l.kind].label} · ${l.days} día${Number(l.days) === 1 ? '' : 's'}`;
}

/** Abre un documento protegido en otra pestaña. */
export async function openDocument(path: string) {
  const win = window.open('', '_blank');
  try {
    const url = await fetchBlobUrl(path);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch {
    win?.close();
    alert('No se pudo abrir el documento.');
  }
}

/** Carga de un documento (foto desde el celular o PDF). */
export function DocumentUpload({
  endpoint,
  kinds,
  defaultKind,
  onUploaded,
  compact = false,
}: {
  endpoint: string;
  kinds: DocumentKind[];
  defaultKind?: DocumentKind;
  onUploaded: (d: StoredDocument) => void;
  compact?: boolean;
}) {
  const [kind, setKind] = useState<DocumentKind>(defaultKind ?? kinds[0]!);
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);
    form.set('kind', kind);
    if (expires) form.set('expires_on', expires);
    try {
      const res = await api<{ document: StoredDocument }>(endpoint, { body: form, timeoutMs: 90000 });
      onUploaded(res.document);
      setExpires('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo subir el archivo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className={compact ? 'toolbar' : 'form-grid'}>
        {!defaultKind && (
          <label className="field">
            Tipo de documento
            <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KINDS[k]}
                </option>
              ))}
            </select>
          </label>
        )}
        {!compact && ['ine', 'licencia', 'certificacion'].includes(kind) && (
          <label className="field">
            Vence <small>opcional</small>
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
        )}
      </div>
      <label className={`btn ${compact ? 'small' : 'block'}`} style={{ cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Subiendo…' : compact ? 'Subir' : 'Tomar foto o elegir archivo'}
        <input
          type="file"
          accept="image/*,application/pdf"
          hidden
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
