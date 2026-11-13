/**
 * Segundo paso por correo (administradores): el navegador guarda un token de "dispositivo de
 * confianza" por usuario durante 30 días. Con él, entrar con la contraseña basta; sin él, se pide
 * un código al correo.
 */
const key = (userId: string) => `korporia-device:${userId}`;

export function deviceToken(userId: string): string | null {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function saveDeviceToken(userId: string, token: string | undefined | null) {
  if (!token) return;
  try {
    localStorage.setItem(key(userId), token);
  } catch {
    /* navegación privada: se pedirá el código la próxima vez */
  }
}

export interface DeviceStatus {
  verified: boolean;
  needsPassword?: boolean;
  canSetPassword?: boolean;
  email?: string | null;
}

/** Contraseña: mismas reglas que el servidor. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Usa al menos 10 caracteres.';
  if (password.length > 72) return 'Usa como máximo 72 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(password) || !/\d/.test(password)) return 'Combina letras y números.';
  return null;
}

// ---------------------------------------------------------------------
// Cambios sensibles: si el servidor pide un código reciente (step_up), la app lo pide y reintenta
// ---------------------------------------------------------------------
type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
let pending: Promise<boolean> | null = null;

export function setStepUpHandler(handler: StepUpHandler | null) {
  stepUpHandler = handler;
}

/** Pide el código del correo (una sola ventana aunque varias llamadas lo necesiten a la vez). */
export function requestStepUp(): Promise<boolean> {
  if (!stepUpHandler) return Promise.resolve(false);
  pending ??= stepUpHandler().finally(() => {
    pending = null;
  });
  return pending;
}
