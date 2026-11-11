export interface Position {
  lat: number;
  lng: number;
  accuracy_m: number;
}

export class LocationError extends Error {}

/**
 * Pide la ubicación con alta precisión. Si la primera lectura es imprecisa,
 * espera unos segundos más por una mejor (el GPS de Android mejora rápido).
 */
export function getPosition(timeoutMs = 15000, goodEnoughM = 30): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationError('Este navegador no permite obtener la ubicación.'));
      return;
    }
    let best: Position | null = null;
    let done = false;
    const finish = (pos: Position | null, err?: LocationError) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      if (pos) resolve(pos);
      else reject(err ?? new LocationError('No se pudo obtener tu ubicación. Sal a un lugar abierto e intenta de nuevo.'));
    };
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) };
        if (!best || pos.accuracy_m < best.accuracy_m) best = pos;
        if (pos.accuracy_m <= goodEnoughM) finish(pos);
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) {
          finish(null, new LocationError('Permite el acceso a la ubicación en tu navegador para poder checar.'));
        }
        // Otros errores: seguimos esperando hasta el tiempo límite
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
    const timer = setTimeout(() => finish(best), timeoutMs);
  });
}
