/** ¿Se está usando desde un celular o tableta? (si no, es una computadora con cámara web) */
export function isMobileDevice(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  // iPad reciente se presenta como Mac, pero tiene pantalla táctil
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export interface CameraProfile {
  mobile: boolean;
  /** Proporción mínima del ancho que debe ocupar el rostro */
  minFaceRatio: number;
  /** Resolución que se pide a la cámara */
  width: number;
  height: number;
}

/**
 * En la computadora la persona se sienta más lejos de la cámara web y la imagen
 * es horizontal, así que el rostro ocupa menos del cuadro; en el celular, al
 * revés. Cada uno tiene su propio umbral.
 */
export function cameraProfile(): CameraProfile {
  const mobile = isMobileDevice();
  return mobile ? { mobile, minFaceRatio: 0.24, width: 640, height: 480 } : { mobile, minFaceRatio: 0.14, width: 1280, height: 720 };
}
