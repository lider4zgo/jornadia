/** Copia el cuadro actual del video a un canvas (sin el efecto espejo de la vista previa). */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  return canvas;
}

/**
 * Convierte a JPEG ligero (~50 KB): 480 px de ancho y calidad decreciente
 * hasta quedar bajo el tamaño máximo.
 */
export async function toCompressedJpeg(source: HTMLCanvasElement, maxWidth = 480, maxBytes = 90_000): Promise<Blob> {
  const scale = Math.min(1, maxWidth / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);

  let quality = 0.72;
  let blob: Blob | null = null;
  while (quality >= 0.35) {
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) break;
    quality -= 0.1;
  }
  if (!blob) throw new Error('No se pudo procesar la foto.');
  return blob;
}
