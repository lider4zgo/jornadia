/**
 * Versiones vigentes de los documentos legales publicados en korporia.com.
 * Al publicar una versión nueva, cámbiala aquí: cada aceptación guarda la versión
 * que la persona vio (Legal: versión, fecha, usuario e IP).
 */
export const LEGAL_VERSIONS = {
  terminos: '2.2',
  privacidad: '2026-11-06',
  /** Aviso simplificado de la lista de espera */
  listaEspera: '2026-11-06',
} as const;

export const LEGAL_URLS = {
  terminos: 'https://korporia.com/terminos',
  privacidad: 'https://korporia.com/privacidad',
} as const;

/** Korporia Starter (términos 2.2, sección 3.1). */
export const STARTER = {
  maxEmployees: 25,
  clockDays: 90,
  hrMonths: 6,
} as const;

/**
 * Código corto de la empresa con el que entran los colaboradores (3–16 letras minúsculas o números),
 * a partir del nombre: "Eléctrica Laguna S.A. de C.V." → "electricalag".
 */
export function companyCodeFromName(name: string, maxLength = 12): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(s\.?\s*a\.?|de|c\.?\s*v\.?|s\.?\s*de\s*r\.?\s*l\.?|sapi|sas|y|la|el|los|las)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const code = words.join('').slice(0, maxLength);
  return code.length >= 3 ? code : (code + 'kp').padEnd(3, '0');
}
