import catalog from './permissions.json';

/**
 * Catálogo de módulos, permisos y roles del sistema.
 *
 * La fuente es `permissions.json`; la migración SQL de `core` siembra los mismos
 * datos y `supabase/tests/run.mjs` verifica que ambos coincidan.
 */

export type ModuleKey = 'core' | 'jornada' | 'rh' | 'nomina' | 'finanzas' | 'reclutamiento';
export type SystemRoleKey = 'owner' | 'admin' | 'supervisor' | 'worker';

export interface ModuleInfo {
  key: ModuleKey;
  name: string;
  billable: boolean;
}

export interface PermissionInfo {
  key: string;
  label: string;
  /** Sigue disponible cuando el módulo o la cuenta están en solo lectura (consultas y exportación) */
  readOnlyOk?: boolean;
}

export interface SystemRole {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: string[];
}

export const MODULES = catalog.modules as ModuleInfo[];
export const PERMISSIONS = catalog.permissions as PermissionInfo[];

const ALL_KEYS = PERMISSIONS.map((p) => p.key);

/** Permisos de consulta: funcionan aunque el plan haya dejado el módulo en solo lectura. */
export const READ_ONLY_OK = new Set(PERMISSIONS.filter((p) => p.readOnlyOk).map((p) => p.key));

export const SYSTEM_ROLES: SystemRole[] = catalog.systemRoles.map((r) => ({
  key: r.key as SystemRoleKey,
  name: r.name,
  description: r.description,
  permissions: r.permissions === '*' ? [...ALL_KEYS] : [...(r.permissions as string[])],
}));

/** Módulo al que pertenece un permiso: `jornada.checar` → `jornada`. */
export function moduleOf(permission: string): ModuleKey {
  return permission.split('.')[0] as ModuleKey;
}

export function isKnownPermission(permission: string): boolean {
  return ALL_KEYS.includes(permission);
}

/**
 * ¿Puede quien tiene `actor` otorgar un rol con `role`?
 * Solo si el rol tiene estrictamente menos permisos que quien lo otorga: así un
 * administrador da de alta supervisores, pero no otros administradores, y nadie
 * puede darse a sí mismo (ni a otro) más de lo que ya tiene.
 */
export function canGrantRole(actor: Iterable<string>, role: Iterable<string>): boolean {
  const mine = new Set(actor);
  const theirs = new Set(role);
  for (const p of theirs) if (!mine.has(p)) return false;
  return theirs.size < mine.size;
}
