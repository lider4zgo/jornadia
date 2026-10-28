import type { Human, Config } from '@vladmandic/human';
import { grabFrame } from './image';

// Verificación facial en el teléfono, sin costo por uso.
// Prueba de vida en dos capas:
//   1. Modelos "antispoof" y "liveness" de Human (detectan fotos y pantallas).
//   2. Reto de parpadeo: una foto impresa o un video pausado no parpadea.

export const LIVENESS_MIN = 0.5;
export const ANTISPOOF_MIN = 0.5;
const MIN_FACE_RATIO = 0.28; // el rostro debe ocupar al menos 28 % del ancho
const TIMEOUT_MS = 25_000;

const config: Partial<Config> = {
  modelBasePath: '/models/',
  backend: 'webgl',
  debug: false,
  cacheSensitivity: 0, // analiza cada cuadro; el parpadeo dura muy poco
  // Analiza una copia reducida del cuadro (más rápido y estable en equipos modestos)
  filter: { enabled: true, equalization: false, flip: false, width: 640 } as Config['filter'],
  face: {
    enabled: true,
    detector: { enabled: true, modelPath: 'blazeface.json', rotation: false, maxDetected: 2, minConfidence: 0.6, return: false },
    mesh: { enabled: true, modelPath: 'facemesh.json' },
    iris: { enabled: true, modelPath: 'iris.json' },
    description: { enabled: true, modelPath: 'faceres.json' },
    antispoof: { enabled: true, modelPath: 'antispoof.json' },
    liveness: { enabled: true, modelPath: 'liveness.json' },
    emotion: { enabled: false },
    attention: { enabled: false },
    gear: { enabled: false },
  } as Config['face'],
  body: { enabled: false } as Config['body'],
  hand: { enabled: false } as Config['hand'],
  object: { enabled: false } as Config['object'],
  segmentation: { enabled: false } as Config['segmentation'],
  gesture: { enabled: true },
};

let humanPromise: Promise<Human> | null = null;

/** Carga los modelos una sola vez (la primera vez se descargan ~13 MB y quedan en caché). */
export function loadFaceEngine(): Promise<Human> {
  if (!humanPromise) {
    humanPromise = (async () => {
      const { Human } = await import('@vladmandic/human');
      const human = new Human(config);
      await human.load();
      await human.warmup();
      return human;
    })().catch((err) => {
      humanPromise = null;
      throw err;
    });
  }
  return humanPromise;
}

export async function faceModelVersion(): Promise<string> {
  const human = await loadFaceEngine();
  return `human-${human.version}-faceres`;
}

export type CheckStep = 'loading' | 'position' | 'closer' | 'one-face' | 'blink' | 'hold' | 'done';

export interface CheckResult {
  /** Descriptor promedio de los mejores cuadros con ojos abiertos */
  embedding: number[];
  live: number;
  real: number;
  blinked: boolean;
  livenessPassed: boolean;
  /** Cuadro para la selfie (ojos abiertos, mejor calidad) */
  frame: HTMLCanvasElement;
  similarity: number | null;
}

interface Sample {
  embedding: number[];
  score: number;
  live: number;
  real: number;
}

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function averageEmbedding(samples: Sample[]): number[] {
  const len = samples[0]!.embedding.length;
  const out = new Array<number>(len).fill(0);
  for (const s of samples) for (let i = 0; i < len; i++) out[i]! += s.embedding[i]! / samples.length;
  return out;
}

type Point = [number, number, number?];
const dist = (a: Point | undefined, b: Point | undefined) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0);

/**
 * Apertura de los ojos (eye aspect ratio) a partir de la malla facial de 468 puntos.
 * Ojos abiertos ≈ 0.25–0.35; durante un parpadeo baja a la mitad o menos.
 */
function eyeOpenness(mesh: Point[] | undefined): number | null {
  if (!mesh || mesh.length < 400) return null;
  const left = dist(mesh[159], mesh[145]) / (dist(mesh[33], mesh[133]) || 1);
  const right = dist(mesh[386], mesh[374]) / (dist(mesh[362], mesh[263]) || 1);
  return (left + right) / 2;
}

export interface FaceCheckOptions {
  reference: number[] | null;
  onStep: (s: CheckStep) => void;
  signal: AbortSignal;
  /** Proporción mínima del ancho que debe ocupar el rostro (depende del dispositivo) */
  minFaceRatio?: number;
  /**
   * Captura manual (solo en la foto de registro tomada en persona): cuando el
   * supervisor la pide, se termina con los cuadros buenos acumulados, sin exigir
   * parpadeo. La prueba de vida queda a cargo de los modelos anti-suplantación.
   */
  manual?: { requested: boolean };
  /** Avisa si hay un rostro bien encuadrado (para habilitar la captura manual) */
  onReady?: (ready: boolean) => void;
  /** Métricas por cuadro para calibrar (se muestran con ?debug en la dirección) */
  onDebug?: (d: FaceDebug) => void;
}

export interface FaceDebug {
  fps: number;
  faces: number;
  ratio: number;
  score: number;
  live: number;
  real: number;
  ear: number | null;
  baseline: number | null;
}

/** Mantiene un valor hasta que el nuevo se repite varios cuadros seguidos (evita parpadeos en pantalla). */
function stabilizer<T>(framesToSwitch: number, emit: (v: T) => void) {
  let current: T | undefined;
  let candidate: T | undefined;
  let count = 0;
  return (next: T, immediate = false) => {
    if (next === current) {
      candidate = undefined;
      count = 0;
      return;
    }
    if (immediate || current === undefined) {
      current = next;
      emit(next);
      return;
    }
    if (next === candidate) count++;
    else {
      candidate = next;
      count = 1;
    }
    if (count >= framesToSwitch) {
      current = next;
      candidate = undefined;
      count = 0;
      emit(next);
    }
  };
}

const median3 = (xs: number[]) => {
  const last = xs.slice(-3).sort((a, b) => a - b);
  return last[Math.floor(last.length / 2)] ?? null;
}

/**
 * Analiza el video hasta completar el reto de parpadeo (o la captura manual) o
 * agotar el tiempo. `reference`: descriptor registrado del trabajador (null en el alta).
 */
export async function runFaceCheck(video: HTMLVideoElement, opts: FaceCheckOptions): Promise<CheckResult> {
  opts.onStep('loading');
  const human = await loadFaceEngine();
  const minRatio = opts.minFaceRatio ?? MIN_FACE_RATIO;
  const started = performance.now();

  // Instrucciones y botón estables: solo cambian si el estado se mantiene ~5 cuadros
  const setStep = stabilizer<CheckStep>(5, opts.onStep);
  let readyLatched = false;
  let framesWithoutFace = 0;

  const open: Sample[] = [];
  let bestFrame: HTMLCanvasElement | null = null;
  let bestScore = 0;
  let lastGrab = 0;
  let openFramesBeforeBlink = 0;
  let blinked = false;
  let framesAfterBlink = 0;
  const rawEars: number[] = [];
  const openness: number[] = [];
  let eyesClosed = false;
  let frames = 0;
  let fpsWindowStart = performance.now();
  let fps = 0;

  const finish = (byBlink: boolean): CheckResult => {
    const samples = [...open].sort((a, b) => b.score - a.score).slice(0, 5);
    const embedding = averageEmbedding(samples);
    const live = average(open.map((s) => s.live));
    const real = average(open.map((s) => s.real));
    const modelsOk = live >= LIVENESS_MIN && real >= ANTISPOOF_MIN;
    opts.onStep('done');
    return {
      embedding,
      live,
      real,
      blinked: byBlink,
      livenessPassed: byBlink ? modelsOk : modelsOk && Boolean(opts.manual),
      frame: bestFrame!,
      // Similitud normalizada de Human (0..1); > 0.5 suele indicar la misma persona
      similarity: opts.reference ? Math.round(human.match.similarity(embedding, opts.reference) * 1000) / 1000 : null,
    };
  };

  while (!opts.signal.aborted) {
    if (performance.now() - started > TIMEOUT_MS && !opts.manual) {
      throw new Error('No pudimos verificar tu rostro. Busca mejor luz, quítate lentes oscuros o gorra y vuelve a intentar.');
    }
    if (video.readyState < 2) {
      await new Promise((r) => setTimeout(r, 60));
      continue;
    }
    const result = await human.detect(video);
    frames++;
    if (performance.now() - fpsWindowStart >= 1000) {
      fps = frames;
      frames = 0;
      fpsWindowStart = performance.now();
    }

    // Rostro principal = el más grande; otro rostro solo cuenta si es de tamaño comparable
    const faces = [...result.face].sort((a, b) => (b.boxRaw?.[2] ?? 0) - (a.boxRaw?.[2] ?? 0));
    const main = faces[0];
    const mainWidth = main?.boxRaw?.[2] ?? 0;
    const others = faces.slice(1).filter((f) => (f.boxRaw?.[2] ?? 0) >= mainWidth * 0.5);
    let usableNow = false;
    let ear: number | null = null;
    let baseline: number | null = null;

    if (!main) {
      setStep('position');
    } else if (others.length > 0) {
      setStep('one-face');
    } else if (mainWidth < minRatio) {
      setStep('closer');
    } else {
      const face = main;
      const score = face.faceScore ?? face.score;
      usableNow = Boolean(face.embedding && face.embedding.length > 0) && score > 0.5;

      // Parpadeo: gesto de Human o caída clara de la apertura de los ojos (suavizada)
      const rawEar = eyeOpenness(face.mesh as Point[] | undefined);
      if (rawEar != null) {
        rawEars.push(rawEar);
        if (rawEars.length > 5) rawEars.shift();
      }
      ear = rawEar != null ? median3(rawEars) : null;
      baseline = openness.length >= 4 ? average(openness) : null;
      const gestureBlink = result.gesture.some((g) => 'face' in g && g.face === 0 && String(g.gesture).startsWith('blink'));
      // Se usa el valor sin suavizar para no perder parpadeos muy rápidos
      const earClosed = rawEar != null && baseline != null && rawEar < baseline * 0.7;
      const blinking = gestureBlink || earClosed;
      if (earClosed) eyesClosed = true;
      const reopened = eyesClosed && ear != null && baseline != null && ear > baseline * 0.85;

      if (openFramesBeforeBlink >= 4 && (gestureBlink || reopened)) blinked = true;
      if (reopened) eyesClosed = false;

      if (usableNow && !blinking) {
        if (ear != null && !eyesClosed) {
          openness.push(ear);
          if (openness.length > 15) openness.shift();
        }
        if (!blinked) openFramesBeforeBlink++;
        else framesAfterBlink++;
        open.push({ embedding: face.embedding!, score, live: face.live ?? 0, real: face.real ?? 0 });
        if (open.length > 10) open.shift();
        // Copiar el cuadro cuesta: solo si mejora la calidad y como máximo cada 400 ms
        const now = performance.now();
        if (!bestFrame || (score > bestScore + 0.01 && now - lastGrab > 400)) {
          bestScore = score;
          bestFrame = grabFrame(video);
          lastGrab = now;
        }
      }
      setStep(blinked ? 'hold' : 'blink', blinked);

      if (blinked && framesAfterBlink >= 2 && open.length >= 4 && bestFrame) return finish(true);
    }

    // El botón "Tomar foto" se mantiene activo aunque la detección dude un instante
    if (usableNow && open.length >= 3) {
      readyLatched = true;
      framesWithoutFace = 0;
    } else if (!usableNow) {
      framesWithoutFace++;
      if (framesWithoutFace > 15) readyLatched = false;
    }
    opts.onReady?.(readyLatched);
    if (opts.manual?.requested && readyLatched && bestFrame && open.length >= 3) return finish(false);

    opts.onDebug?.({
      fps,
      faces: result.face.length,
      ratio: Math.round(mainWidth * 100) / 100,
      score: Math.round((main?.faceScore ?? main?.score ?? 0) * 100) / 100,
      live: Math.round((main?.live ?? 0) * 100) / 100,
      real: Math.round((main?.real ?? 0) * 100) / 100,
      ear: ear != null ? Math.round(ear * 1000) / 1000 : null,
      baseline: baseline != null ? Math.round(baseline * 1000) / 1000 : null,
    });

    // Cede el hilo para no congelar la pantalla en equipos modestos
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new DOMException('Cancelado', 'AbortError');
}

/** Abre la cámara frontal (selfie) o la trasera (foto de registro tomada por el supervisor). */
export async function openCamera(
  video: HTMLVideoElement,
  facing: 'user' | 'environment' = 'user',
  size: { width: number; height: number } = { width: 640, height: 480 },
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite usar la cámara. Abre Jornadia en Chrome.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: size.width }, height: { ideal: size.height } },
      audio: false,
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    await video.play();
    return stream;
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === 'NotAllowedError') throw new Error('Permite el acceso a la cámara en tu navegador para poder checar.');
    if (name === 'NotFoundError') throw new Error('No encontramos una cámara en este equipo.');
    throw new Error('No se pudo abrir la cámara. Cierra otras apps que la estén usando.');
  }
}
