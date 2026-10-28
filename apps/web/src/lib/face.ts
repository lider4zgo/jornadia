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
  filter: { enabled: true, equalization: true, flip: false } as Config['filter'],
  face: {
    enabled: true,
    detector: { enabled: true, modelPath: 'blazeface.json', rotation: false, maxDetected: 2, minConfidence: 0.5, return: false },
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

/**
 * Analiza el video hasta completar el reto de parpadeo o agotar el tiempo.
 * `reference`: descriptor registrado del trabajador (null en el alta).
 */
export async function runFaceCheck(
  video: HTMLVideoElement,
  opts: { reference: number[] | null; onStep: (s: CheckStep) => void; signal: AbortSignal },
): Promise<CheckResult> {
  opts.onStep('loading');
  const human = await loadFaceEngine();
  const started = performance.now();

  const open: Sample[] = [];
  let bestFrame: HTMLCanvasElement | null = null;
  let bestScore = 0;
  let openFramesBeforeBlink = 0;
  let blinked = false;
  let framesAfterBlink = 0;

  while (!opts.signal.aborted) {
    if (performance.now() - started > TIMEOUT_MS) {
      throw new Error('No pudimos verificar tu rostro. Busca mejor luz, quítate lentes oscuros o gorra y vuelve a intentar.');
    }
    const result = await human.detect(video);
    const faces = result.face;

    if (faces.length === 0) {
      opts.onStep('position');
    } else if (faces.length > 1) {
      opts.onStep('one-face');
    } else {
      const face = faces[0]!;
      const ratio = face.box[2] / (video.videoWidth || 1);
      if (ratio < MIN_FACE_RATIO) {
        opts.onStep('closer');
      } else {
        const blinking = result.gesture.some((g) => 'face' in g && g.face === 0 && String(g.gesture).startsWith('blink'));
        const usable = face.embedding && face.embedding.length > 0 && (face.faceScore ?? face.score) > 0.6;

        if (blinking && openFramesBeforeBlink >= 3) blinked = true;

        if (usable && !blinking) {
          if (!blinked) openFramesBeforeBlink++;
          else framesAfterBlink++;
          open.push({ embedding: face.embedding!, score: face.faceScore ?? face.score, live: face.live ?? 0, real: face.real ?? 0 });
          if (open.length > 8) open.shift();
          if ((face.faceScore ?? face.score) >= bestScore) {
            bestScore = face.faceScore ?? face.score;
            bestFrame = grabFrame(video);
          }
        }

        opts.onStep(blinked ? 'hold' : 'blink');

        // Listo: parpadeó y hay suficientes cuadros buenos después
        if (blinked && framesAfterBlink >= 2 && open.length >= 4 && bestFrame) {
          const samples = [...open].sort((a, b) => b.score - a.score).slice(0, 5);
          const embedding = averageEmbedding(samples);
          const live = average(open.map((s) => s.live));
          const real = average(open.map((s) => s.real));
          opts.onStep('done');
          return {
            embedding,
            live,
            real,
            blinked,
            livenessPassed: blinked && live >= LIVENESS_MIN && real >= ANTISPOOF_MIN,
            frame: bestFrame,
            // Similitud normalizada de Human (0..1); > 0.5 suele indicar la misma persona
            similarity: opts.reference ? Math.round(human.match.similarity(embedding, opts.reference) * 1000) / 1000 : null,
          };
        }
      }
    }
    // Cede el hilo para no congelar la pantalla en teléfonos modestos
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new DOMException('Cancelado', 'AbortError');
}

/** Abre la cámara frontal (selfie) o la trasera (foto de registro tomada por el supervisor). */
export async function openCamera(video: HTMLVideoElement, facing: 'user' | 'environment' = 'user'): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite usar la cámara. Abre Jornadia en Chrome.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } },
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
    if (name === 'NotFoundError') throw new Error('No encontramos una cámara en este teléfono.');
    throw new Error('No se pudo abrir la cámara. Cierra otras apps que la estén usando.');
  }
}
