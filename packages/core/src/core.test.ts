import { describe, expect, it } from 'vitest';
import { MODULES, PERMISSIONS, SYSTEM_ROLES, canGrantRole, isKnownPermission, moduleOf, workerEmail } from './index';

const role = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!.permissions;

describe('catálogo de permisos', () => {
  it('cada permiso pertenece a un módulo conocido', () => {
    const modules = MODULES.map((m) => m.key);
    for (const p of PERMISSIONS) expect(modules).toContain(moduleOf(p.key));
  });

  it('los roles del sistema solo usan permisos del catálogo', () => {
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(isKnownPermission(p), `${r.key}: ${p}`).toBe(true);
  });

  it('el dueño tiene todos los permisos', () => {
    expect(role('owner').sort()).toEqual(PERMISSIONS.map((p) => p.key).sort());
  });

  it('el colaborador solo puede checar', () => {
    expect(role('worker')).toEqual(['jornada.checar']);
  });
});

describe('canGrantRole', () => {
  it('el dueño puede crear administradores', () => {
    expect(canGrantRole(role('owner'), role('admin'))).toBe(true);
  });

  it('un administrador crea supervisores y colaboradores, pero no administradores', () => {
    expect(canGrantRole(role('admin'), role('supervisor'))).toBe(true);
    expect(canGrantRole(role('admin'), role('worker'))).toBe(true);
    expect(canGrantRole(role('admin'), role('admin'))).toBe(false);
    expect(canGrantRole(role('admin'), role('owner'))).toBe(false);
  });

  it('nadie otorga un permiso que no tiene', () => {
    expect(canGrantRole(['a', 'b', 'c'], ['a', 'z'])).toBe(false);
  });

  it('el supervisor no puede crear supervisores', () => {
    expect(canGrantRole(role('supervisor'), role('supervisor'))).toBe(false);
  });
});

describe('identidad', () => {
  it('arma el correo interno del colaborador', () => {
    expect(workerEmail(' 00-1 ', 'ELaguna', 'trabajadores.korporia.com')).toBe('001@elaguna.trabajadores.korporia.com');
  });
});
