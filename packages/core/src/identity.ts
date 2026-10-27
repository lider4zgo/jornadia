/** Dominio ficticio de las cuentas de trabajador (nunca se envían correos a él). */
export const DEFAULT_WORKER_EMAIL_DOMAIN = 'trabajadores.jornadia.mx';

export function normalizeCompanyCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeEmployeeNumber(employeeNumber: string): string {
  return employeeNumber.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Correo interno de un trabajador. Los trabajadores inician sesión con
 * código de empresa + número de empleado + NIP; la app arma este correo.
 */
export function workerEmail(employeeNumber: string, companyCode: string, domain = DEFAULT_WORKER_EMAIL_DOMAIN): string {
  return `${normalizeEmployeeNumber(employeeNumber)}@${normalizeCompanyCode(companyCode)}.${domain}`;
}
