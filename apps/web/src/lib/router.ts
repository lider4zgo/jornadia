import { useSyncExternalStore } from 'react';

/**
 * Enrutador mínimo sobre la History API (sin dependencias).
 * Rutas: /<módulo>/<sección>, por ejemplo /jornada/hoy.
 * El Worker ya responde index.html a cualquier ruta (single-page-application).
 */
const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
};

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function navigate(path: string, { replace = false } = {}) {
  if (path === window.location.pathname) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Divide la ruta en módulo y sección: /jornada/hoy → ['jornada', 'hoy']. */
export function splitPath(path: string): [module: string, section: string] {
  const [, module = '', section = ''] = path.split('/');
  return [module, section];
}
