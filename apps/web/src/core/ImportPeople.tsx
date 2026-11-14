import { useState, type ChangeEvent } from 'react';
import { IMPORT_COLUMNS, matchImportHeaders, readImportRow, type ImportField, type ImportRow } from '@korporia/core';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import type { Me } from '../types';

/**
 * PLT-11: importar personal desde Excel (Erik, 14 nov 2026).
 *  1. Plantilla o archivo propio (.xlsx o .csv): se reconocen los encabezados con o sin acentos.
 *  2. Vista previa: quién es nuevo, quién se actualiza (mismo número) y qué filas tienen errores.
 *  3. Se guarda de 10 en 10 y al final sale la hoja de accesos con el código de activación de cada alta.
 */
type Preview = {
  rows: { index: number; action: 'create' | 'update' | 'error'; employee_number: string; full_name: string; errors: string[]; warnings: string[] }[];
  summary: { create: number; update: number; error: number; employeeLimit: number; activeEmployees: number };
  saves: { rh: boolean; schedule: boolean };
};
type Result = { index: number; action: 'create' | 'update' | 'error'; employee_number: string; full_name: string; error?: string; activation?: { code: string; expires_at: string } };

const CHUNK = 10;

/** CSV sencillo (coma o punto y coma, comillas dobles). */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function readFile(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text());
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets = await readXlsxFile(file);
  // La primera hoja que tenga encabezados reconocibles (la plantilla trae una de instrucciones)
  const withHeaders = sheets.find((s) => findHeader(s.data as unknown[][]) >= 0);
  return ((withHeaders ?? sheets[0])?.data ?? []) as unknown[][];
}

function findHeader(data: unknown[][]): number {
  for (let i = 0; i < Math.min(data.length, 15); i++) {
    const { columns } = matchImportHeaders(data[i] ?? []);
    if (columns.employee_number !== undefined && columns.full_name !== undefined) return i;
  }
  return -1;
}

async function downloadTemplate(me: Me) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const hasRh = me.modules.includes('rh');
  const hasJornada = me.modules.includes('jornada');
  const cols = IMPORT_COLUMNS.filter((c) => !c.module || (c.module === 'rh' ? hasRh : hasJornada));
  const header = cols.map((c) => ({ value: c.title, fontWeight: 'bold' as const, backgroundColor: '#ECEEFC' }));
  const example = (c: (typeof cols)[number]) => (c.field === 'site' ? (me.sites?.[0]?.name ?? c.example) : c.example);
  const help = [
    [{ value: 'Columna', fontWeight: 'bold' as const }, { value: 'Ejemplo', fontWeight: 'bold' as const }, { value: 'Cómo llenarla', fontWeight: 'bold' as const }],
    ...cols.map((c) => [{ value: c.title }, { value: example(c), type: String }, { value: c.help }]),
    [],
    [{ value: 'Llena una persona por fila en la hoja "Personal".' }],
    [{ value: 'Si el número de empleado ya existe en Korporia, la fila actualiza a esa persona. Las celdas vacías no borran lo que ya está guardado.' }],
  ];
  await writeXlsxFile(
    [
      { sheet: 'Personal', data: [header], columns: cols.map((c) => ({ width: Math.max(14, c.title.length + 4) })), stickyRowsCount: 1 },
      { sheet: 'Instrucciones', data: help, columns: [{ width: 22 }, { width: 22 }, { width: 80 }] },
    ],
  ).toFile('korporia_plantilla_personal.xlsx');
}

export function ImportPeople({ me }: { me: Me }) {
  const company = me.company!;
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<{ index: number; excelRow: number; row: ImportRow }[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRows(null);
    setPreview(null);
    setResults(null);
    setProgress(null);
    setIgnored([]);
    setFileName('');
    setError(null);
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('El archivo pesa más de 5 MB.');
      const data = await readFile(file);
      const headerAt = findHeader(data);
      if (headerAt < 0) throw new Error('No encontramos las columnas "Número de empleado" y "Nombre completo". Usa la plantilla o revisa los encabezados.');
      const { columns, ignored: skipped } = matchImportHeaders(data[headerAt] ?? []);
      const parsed = data
        .slice(headerAt + 1)
        .map((cells, i) => ({ index: i, excelRow: headerAt + 2 + i, row: readImportRow(cells ?? [], columns as Partial<Record<ImportField, number>>) }))
        .filter((r) => Object.keys(r.row).length > 0)
        .map((r, i) => ({ ...r, index: i }));
      if (!parsed.length) throw new Error('El archivo no tiene personas debajo de los encabezados.');
      if (parsed.length > 2000) throw new Error('Máximo 2,000 personas por archivo.');
      setRows(parsed);
      setIgnored(skipped);
      setPreview(await api<Preview>('/api/core/import/preview', { body: { rows: parsed.map((r) => r.row) }, timeoutMs: 60000 }));
    } catch (err) {
      setRows(null);
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'No se pudo leer el archivo. Guárdalo como Excel (.xlsx) o CSV.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!rows || !preview) return;
    const toSave = preview.rows.filter((r) => r.action !== 'error').map((r) => ({ index: r.index, row: rows[r.index]!.row }));
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: toSave.length });
    const all: Result[] = [];
    try {
      for (let i = 0; i < toSave.length; i += CHUNK) {
        const chunk = toSave.slice(i, i + CHUNK);
        const res = await api<{ results: Result[] }>('/api/core/import/commit', { body: { rows: chunk }, timeoutMs: 90000 });
        all.push(...res.results);
        setProgress({ done: Math.min(toSave.length, i + CHUNK), total: toSave.length });
      }
    } catch (err) {
      setError(
        `${err instanceof ApiError ? err.message : 'Se perdió la conexión.'} Se guardaron ${all.filter((r) => r.action !== 'error').length} de ${toSave.length}. Vuelve a subir el archivo: quien ya quedó se actualiza sin duplicarse.`,
      );
    } finally {
      setResults(all);
      setBusy(false);
    }
  }

  async function downloadAccess(list: Result[]) {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const head = ['Número', 'Nombre', 'Código de empresa', 'Código de activación', 'Vence'].map((v) => ({ value: v, fontWeight: 'bold' as const }));
    const data = [
      head,
      ...list.map((r) => [
        { value: r.employee_number, type: String },
        { value: r.full_name, type: String },
        { value: company.code, type: String },
        { value: r.activation!.code, type: String },
        { value: fmtDate(r.activation!.expires_at), type: String },
      ]),
    ];
    await writeXlsxFile(data, { columns: [{ width: 12 }, { width: 34 }, { width: 18 }, { width: 20 }, { width: 14 }] }).toFile('korporia_accesos.xlsx');
  }

  const fmtDate = (iso: string) => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: company.timezone }).format(new Date(iso));

  // ---- Resultado y hoja de accesos
  if (results) {
    const created = results.filter((r) => r.action === 'create' && r.activation);
    const updated = results.filter((r) => r.action === 'update').length;
    const failed = results.filter((r) => r.action === 'error');
    return (
      <div className="content stack" style={{ paddingBottom: 48 }}>
        <div className="no-print">
          <h1>Importación terminada</h1>
          <p>
            <strong>{created.length}</strong> {created.length === 1 ? 'alta nueva' : 'altas nuevas'} · <strong>{updated}</strong>{' '}
            {updated === 1 ? 'actualizada' : 'actualizadas'}
            {failed.length > 0 && (
              <>
                {' '}
                · <strong>{failed.length}</strong> con error
              </>
            )}
          </p>
          {error && <div className="notice error">{error}</div>}
          {failed.length > 0 && (
            <div className="notice warn">
              {failed.map((f) => (
                <div key={f.index}>
                  {f.employee_number} {f.full_name}: {f.error}
                </div>
              ))}
            </div>
          )}
        </div>
        {created.length > 0 && (
          <section className="card print-area">
            <h2 style={{ marginTop: 0 }}>Hoja de accesos · {company.name}</h2>
            <p>
              Cada persona entra en <strong>app.korporia.com</strong> con el código de empresa <strong>{company.code}</strong>, su número y el código de
              activación; ahí crea su PIN de 4 dígitos. Los códigos vencen en 7 días; si alguno vence, genera otro desde Personal.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Nombre</th>
                    <th>Código de activación</th>
                    <th>Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {created.map((r) => (
                    <tr key={r.index}>
                      <td>{r.employee_number}</td>
                      <td>{r.full_name}</td>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.1rem', letterSpacing: 2 }}>{r.activation!.code}</td>
                      <td>{fmtDate(r.activation!.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="notice warn no-print" style={{ marginTop: 12 }}>
              Estos códigos solo se muestran ahora. Imprime o descarga la hoja antes de salir.
            </div>
            <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="btn solid" onClick={() => window.print()}>
                Imprimir
              </button>
              <button className="btn" onClick={() => void downloadAccess(created)}>
                Descargar para Excel
              </button>
            </div>
          </section>
        )}
        <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={reset}>
            Importar otro archivo
          </button>
          <button className="btn quiet" onClick={() => navigate(me.modules.includes('rh') ? '/rh/expedientes' : '/jornada/personal')}>
            Ir al personal
          </button>
        </div>
      </div>
    );
  }

  const s = preview?.summary;
  const rowNumber = (index: number) => rows?.[index]?.excelRow ?? index + 2;
  const willSave = (s?.create ?? 0) + (s?.update ?? 0);

  return (
    <div className="content stack" style={{ paddingBottom: 48 }}>
      <h1>Importar personal desde Excel</h1>
      <p className="muted" style={{ margin: 0 }}>
        Sube tu lista en Excel (.xlsx) o CSV. Solo el número de empleado y el nombre son obligatorios. Si el número ya existe, se actualizan sus
        datos; las celdas vacías no borran nada. Al terminar te damos la hoja con el código de activación de cada persona nueva.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => void downloadTemplate(me)}>
          Descargar plantilla
        </button>
        <label className={`btn ${preview ? '' : 'solid'}`} style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy && !progress ? 'Leyendo…' : preview ? 'Elegir otro archivo' : 'Elegir archivo'}
          <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => void pick(e)} disabled={busy} hidden />
        </label>
      </div>
      {error && <div className="notice error">{error}</div>}

      {preview && s && (
        <section className="card stack">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong>{fileName}</strong>
            <span className="pill new">{s.create === 1 ? '1 nueva' : `${s.create} nuevas`}</span>
            <span className="pill upd">{s.update === 1 ? '1 se actualiza' : `${s.update} se actualizan`}</span>
            {s.error > 0 && <span className="pill err">{s.error} con error</span>}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Tu plan: {s.activeEmployees} de {s.employeeLimit} colaboradores activos.
            {!preview.saves.rh && ' Los datos del expediente (CURP, RFC, NSS, salario, contrato) no se guardan con tu plan o permisos.'}
            {ignored.length > 0 && ` Columnas que no se usan: ${ignored.join(', ')}.`}
          </p>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th className="num">Fila</th>
                  <th>Número</th>
                  <th>Nombre</th>
                  <th>Qué pasa</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.index}>
                    <td className="num muted">{rowNumber(r.index)}</td>
                    <td>{r.employee_number || '—'}</td>
                    <td>{r.full_name || '—'}</td>
                    <td>
                      <span className={`pill ${r.action === 'create' ? 'new' : r.action === 'update' ? 'upd' : 'err'}`}>
                        {r.action === 'create' ? 'Nueva' : r.action === 'update' ? 'Se actualiza' : 'No se guarda'}
                      </span>
                      {[...r.errors, ...r.warnings].map((m) => (
                        <div key={m} className="muted" style={{ fontSize: '0.85rem', color: r.errors.includes(m) ? 'var(--stop)' : undefined }}>
                          {m}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {progress && (
            <div>
              <div className="import-bar" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
                <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
              <small className="muted">
                Guardando {progress.done} de {progress.total}…
              </small>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn solid" onClick={() => void commit()} disabled={busy || willSave === 0}>
              {busy && progress ? 'Guardando…' : `Importar ${willSave} ${willSave === 1 ? 'persona' : 'personas'}`}
            </button>
            {s.error > 0 && <small className="muted" style={{ alignSelf: 'center' }}>Las filas con error se saltan; corrígelas y vuelve a subir el archivo.</small>}
          </div>
        </section>
      )}
    </div>
  );
}
