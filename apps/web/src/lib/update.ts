import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Service worker: la app abre y guarda checadas aun sin señal.
 * Cuando hay una versión nueva NO se recarga sola (se perdería lo capturado):
 * se muestra un aviso y la persona decide cuándo actualizar.
 */
let available = false;
const listeners = new Set<() => void>();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    available = true;
    listeners.forEach((l) => l());
  },
});

export function applyUpdate() {
  void updateSW(true);
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => available,
  );
}
