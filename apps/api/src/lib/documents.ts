import { HTTPException } from 'hono/http-exception';
import { DOCUMENT_KINDS, DOCUMENT_MIME, type DocumentKind } from '@korporia/core';
import type { Env } from '../env';
import { adminClient, coreDb, rhDb } from './supabase';

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

const MB = 1024 * 1024;

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

export const DOCUMENT_COLUMNS = 'id, employee_id, kind, name, mime, size_bytes, expires_on, by_employee, created_at';

/** Espacio usado y disponible de la empresa (Starter: 50 MB por colaborador activo, como promedio). */
export async function documentQuota(env: Env, companyId: string) {
  const core = coreDb(adminClient(env));
  const [{ data: sub }, { count }, { data: docs }] = await Promise.all([
    core.from('subscriptions').select('doc_mb_per_employee, doc_max_file_mb').eq('company_id', companyId).single(),
    core.from('employees').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('active', true),
    rhDb(adminClient(env)).from('documents').select('size_bytes').eq('company_id', companyId).is('deleted_at', null),
  ]);
  const used = (docs ?? []).reduce((s, d) => s + Number(d.size_bytes), 0);
  const limit = sub?.doc_mb_per_employee ? sub.doc_mb_per_employee * Math.max(1, count ?? 0) * MB : null;
  return { usedBytes: used, limitBytes: limit, maxFileBytes: (sub?.doc_max_file_mb ?? 10) * MB };
}

/** Guarda un documento del expediente en R2 y lo registra. */
export async function storeDocument(
  env: Env,
  input: {
    companyId: string;
    employeeId: string;
    kind: string;
    file: unknown;
    uploadedBy: string;
    byEmployee: boolean;
    expiresOn?: string | null;
    name?: string;
  },
): Promise<StoredDocument> {
  const { file } = input;
  if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: 'Adjunta el archivo.' });
  if (!(input.kind in DOCUMENT_KINDS)) throw new HTTPException(400, { message: 'Tipo de documento inválido.' });
  const mime = file.type || 'application/octet-stream';
  if (!DOCUMENT_MIME.includes(mime)) throw new HTTPException(415, { message: 'Sube un PDF o una foto (JPG, PNG, WebP o HEIC).' });

  const quota = await documentQuota(env, input.companyId);
  if (file.size > quota.maxFileBytes) {
    throw new HTTPException(413, { message: `El archivo pesa más de ${Math.round(quota.maxFileBytes / MB)} MB. Tómale una foto o redúcelo.` });
  }
  if (quota.limitBytes !== null && quota.usedBytes + file.size > quota.limitBytes) {
    throw new HTTPException(402, {
      message: `Se llenó el espacio de documentos de tu plan (${Math.round(quota.limitBytes / MB)} MB). Borra documentos que ya no necesites o contrata Jornada.`,
    });
  }
  const expiresOn = input.expiresOn && /^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn) ? input.expiresOn : null;

  const id = crypto.randomUUID();
  const path = `docs/${input.companyId}/${input.employeeId}/${id}.${EXT[mime] ?? 'bin'}`;
  await env.FILES.put(path, await file.arrayBuffer(), {
    httpMetadata: { contentType: mime },
    customMetadata: { company: input.companyId, employee: input.employeeId, kind: input.kind },
  });
  const name = (input.name || file.name || DOCUMENT_KINDS[input.kind as DocumentKind]).slice(0, 120);
  const { data, error } = await rhDb(adminClient(env))
    .from('documents')
    .insert({
      id,
      company_id: input.companyId,
      employee_id: input.employeeId,
      kind: input.kind,
      name,
      path,
      mime,
      size_bytes: file.size,
      expires_on: expiresOn,
      uploaded_by: input.uploadedBy,
      by_employee: input.byEmployee,
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error || !data) {
    await env.FILES.delete(path);
    console.error('document insert failed', error);
    throw new HTTPException(500, { message: 'No se pudo guardar el documento.' });
  }
  return data as StoredDocument;
}

/** Descarga un documento ya autorizado. */
export async function documentResponse(env: Env, path: string, mime: string, name: string): Promise<Response> {
  const obj = await env.FILES.get(path);
  if (!obj) throw new HTTPException(404, { message: 'El archivo ya no existe.' });
  const safe = name.replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, '_');
  return new Response(obj.body, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(safe)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
