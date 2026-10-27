import { createStore, del, entries, set } from 'idb-keyval';
import { api, ApiError, NetworkError } from './api';
import type { PunchKind } from '@jornadia/core';

// Cola de checadas capturadas sin conexión. Vive en IndexedDB del teléfono,
// sobrevive a cerrar la app y se envía en orden cuando vuelve la señal.
const store = createStore('jornadia', 'punch-queue');

export interface QueuedPunch {
  client_uuid: string;
  companyId: string;
  kind: PunchKind;
  data: Record<string, unknown>;
  selfie: Blob;
  queuedAt: string;
  attempts: number;
  /** Rechazada por el servidor: ya no se reintenta, se muestra al trabajador */
  rejected?: string;
}

type Listener = (items: QueuedPunch[]) => void;
const listeners = new Set<Listener>();

export async function listQueue(): Promise<QueuedPunch[]> {
  const all = await entries<string, QueuedPunch>(store);
  return all.map(([, v]) => v).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

async function notify() {
  const items = await listQueue();
  listeners.forEach((l) => l(items));
}

export function onQueueChange(listener: Listener): () => void {
  listeners.add(listener);
  void listQueue().then(listener);
  return () => listeners.delete(listener);
}

export async function enqueue(item: Omit<QueuedPunch, 'attempts' | 'queuedAt'>) {
  await set(item.client_uuid, { ...item, attempts: 0, queuedAt: new Date().toISOString() }, store);
  await notify();
}

export async function dismiss(clientUuid: string) {
  await del(clientUuid, store);
  await notify();
}

export function punchForm(data: Record<string, unknown>, selfie: Blob): FormData {
  const form = new FormData();
  form.set('data', JSON.stringify(data));
  form.set('selfie', new File([selfie], 'selfie.jpg', { type: selfie.type || 'image/jpeg' }));
  return form;
}

let flushing = false;

/** Envía la cola en orden. Se detiene en el primer error de red. */
export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of await listQueue()) {
      if (item.rejected) continue;
      try {
        await api('/api/punches', {
          body: punchForm(item.data, item.selfie),
          timeoutMs: 30000,
          companyId: item.companyId,
        });
        await del(item.client_uuid, store);
        sent++;
      } catch (err) {
        if (err instanceof NetworkError) break;
        // Sesión vencida: se conserva la checada hasta que el trabajador vuelva a entrar
        if (err instanceof ApiError && err.status === 401) break;
        const message = err instanceof ApiError ? err.message : 'Error desconocido';
        await set(item.client_uuid, { ...item, attempts: item.attempts + 1, rejected: message }, store);
      }
    }
  } finally {
    flushing = false;
    await notify();
  }
  return sent;
}

/** Reintenta automáticamente al volver la señal, al regresar a la app y cada minuto. */
export function startAutoSync(onSent?: (n: number) => void) {
  const run = () => void flushQueue().then((n) => n && onSent?.(n));
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && run());
  const interval = setInterval(run, 60_000);
  run();
  return () => {
    window.removeEventListener('online', run);
    clearInterval(interval);
  };
}
