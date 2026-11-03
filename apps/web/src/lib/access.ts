import type { Me } from '../types';

/** ¿El usuario tiene alguno de los permisos? (la API ya descontó los módulos no contratados) */
export function can(me: Me, ...permissions: string[]): boolean {
  return permissions.some((p) => me.permissions.includes(p));
}

/** ¿El usuario puede entrar al módulo? (la empresa lo tiene y él tiene algún permiso en él) */
export function canEnterModule(me: Me, module: string): boolean {
  return me.modules.includes(module) && me.permissions.some((p) => p.startsWith(`${module}.`));
}
