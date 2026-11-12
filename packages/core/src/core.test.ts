import { describe, expect, it } from 'vitest';
import { MODULES, PERMISSIONS, SYSTEM_ROLES, canGrantRole, companyCodeFromName, isKnownPermission, moduleOf, READ_ONLY_OK, workerEmail } from './index';

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

  it('el colaborador solo checa y usa su propio portal', () => {
    expect(role('worker').sort()).toEqual(['jornada.checar', 'jornada.registros.propios', 'rh.portal.solicitar', 'rh.portal.ver']);
  });

  it('las consultas siguen disponibles en solo lectura; los cambios no', () => {
    expect(READ_ONLY_OK.has('jornada.registros.propios')).toBe(true);
    expect(READ_ONLY_OK.has('jornada.reportes.ver')).toBe(true);
    expect(READ_ONLY_OK.has('jornada.checar')).toBe(false);
    expect(READ_ONLY_OK.has('rh.portal.solicitar')).toBe(false);
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

describe('companyCodeFromName', () => {
  it('quita acentos, razón social y espacios', () => {
    expect(companyCodeFromName('Eléctrica Laguna S.A. de C.V.')).toBe('electricalag');
    expect(companyCodeFromName('Construcciones Ruiz, S. de R.L.')).toBe('construccion');
  });
  it('siempre cumple el formato del código (3–16 letras o números)', () => {
    for (const n of ['A', 'Ñ & Ñ', '123', 'La Casa de los Muebles', '!!!']) {
      expect(companyCodeFromName(n)).toMatch(/^[a-z0-9]{3,16}$/);
    }
  });
});
