import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Me } from '../types';

export interface ModuleProps {
  me: Me;
  /** Sección dentro del módulo (segundo tramo de la ruta) */
  section: string;
  reload: () => Promise<void>;
}

export interface WebModule {
  key: string;
  name: string;
  /** Nombre según quién entra (p. ej., "Mi portal" para el colaborador) */
  label?: (me: Me) => string;
  /** Se descarga solo cuando el usuario entra al módulo */
  Component: LazyExoticComponent<ComponentType<ModuleProps>>;
}

/**
 * Módulos de la app web. Para agregar uno: crea src/modules/<key>/index.tsx con un
 * componente por defecto que reciba ModuleProps y agrégalo aquí.
 */
export const WEB_MODULES: WebModule[] = [
  { key: 'jornada', name: 'Jornada', Component: lazy(() => import('./jornada')) },
  {
    key: 'rh',
    name: 'Personal',
    label: (me) => (me.permissions.some((p) => p.startsWith('rh.') && !p.startsWith('rh.portal.')) ? 'Personal' : 'Mi portal'),
    Component: lazy(() => import('./rh')),
  },
];
