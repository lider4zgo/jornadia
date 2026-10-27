import { accessToken } from './supabase';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** Sin conexión o el servidor no respondió: la checada debe ir a la cola local. */
export class NetworkError extends Error {}

let activeCompany: string | null = null;
export function setActiveCompany(id: string | null) {
  activeCompany = id;
}

interface Options {
  method?: string;
  body?: FormData | Record<string, unknown>;
  timeoutMs?: number;
  raw?: boolean;
  /** Empresa para esta llamada (por defecto, la activa) */
  companyId?: string;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const token = await accessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const company = opts.companyId ?? activeCompany;
  if (company) headers['X-Company-Id'] = company;

  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: controller.signal });
  } catch {
    throw new NetworkError('Sin conexión con el servidor.');
  } finally {
    clearTimeout(timer);
  }

  if (opts.raw && res.ok) return res as unknown as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Respuesta no JSON (por ejemplo, un proxy de la red móvil)
    if (!res.ok) throw new NetworkError('El servidor no respondió correctamente.');
  }
  if (!res.ok) {
    const err = data as { error?: string; code?: string } | null;
    if (res.status >= 500 && !err?.error) throw new NetworkError('El servidor no está disponible.');
    throw new ApiError(err?.error ?? 'Ocurrió un error.', res.status, err?.code);
  }
  return data as T;
}

/** Descarga un archivo protegido (selfie, reporte) como URL local. */
export async function fetchBlobUrl(path: string): Promise<string> {
  const res = await api<Response>(path, { raw: true });
  return URL.createObjectURL(await res.blob());
}
