import { useEffect, useMemo, useRef, useState } from 'react';
import { cameraProfile } from '../lib/device';
import { openCamera, runFaceCheck, type CheckResult, type CheckStep, type FaceDebug } from '../lib/face';

// Con ?debug en la dirección se muestran las métricas de detección (para calibrar en cada teléfono)
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

const ORDER: CheckStep[] = ['position', 'blink', 'hold', 'done'];

interface Props {
  title: string;
  reference: number[] | null;
  onDone: (result: CheckResult) => void;
  onCancel: () => void;
  /** 'environment' = cámara trasera, para que el supervisor fotografíe al trabajador */
  facing?: 'user' | 'environment';
  /** Foto de registro en persona: muestra el botón "Tomar foto" sin exigir parpadeo */
  allowManual?: boolean;
}

/** Pantalla completa de cámara con el reto de parpadeo. */
export function Capture({ title, reference, onDone, onCancel, facing = 'user', allowManual = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const manual = useRef({ requested: false });
  const profile = useMemo(() => cameraProfile(), []);
  const [step, setStep] = useState<CheckStep>('loading');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [debug, setDebug] = useState<FaceDebug | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let stream: MediaStream | null = null;
    manual.current = { requested: false };
    setError(null);
    setReady(false);
    setStep('loading');
    (async () => {
      try {
        stream = await openCamera(videoRef.current!, facing, profile);
        const result = await runFaceCheck(videoRef.current!, {
          reference,
          onStep: setStep,
          onReady: setReady,
          signal: controller.signal,
          minFaceRatio: profile.minFaceRatio,
          manual: allowManual ? manual.current : undefined,
          onDebug: DEBUG ? setDebug : undefined,
        });
        if (!controller.signal.aborted) onDone(result);
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'No se pudo usar la cámara.');
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
      }
    })();
    return () => {
      controller.abort();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const reached = Math.max(0, ORDER.indexOf(step === 'closer' || step === 'one-face' ? 'position' : step));
  const mirrored = facing === 'user';

  const prompts: Record<CheckStep, string> = {
    loading: 'Preparando la cámara',
    position: allowManual ? 'Encuadra el rostro en el óvalo' : 'Coloca tu rostro en el óvalo',
    closer: profile.mobile ? 'Acércate un poco más' : 'Acércate a la cámara',
    'one-face': 'Solo debe aparecer una persona',
    blink: allowManual ? 'Pídele que parpadee o toma la foto' : 'Ahora parpadea',
    hold: 'Quédate quieto',
    done: 'Listo',
  };

  const hint =
    step === 'loading'
      ? 'La primera vez puede tardar unos segundos en preparar la verificación.'
      : !profile.mobile
        ? 'Siéntate frente a la cámara de la computadora, con luz de frente y sin gorra ni lentes oscuros.'
        : facing === 'environment'
          ? 'Apunta al rostro del trabajador, con luz de frente y sin gorra ni lentes oscuros.'
          : 'Busca luz de frente. Quítate gorra y lentes oscuros.';

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <button className="btn quiet" onClick={onCancel}>
          Cancelar
        </button>
      </header>

      <div className="viewfinder" data-step={step} data-desktop={!profile.mobile || undefined}>
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label={facing === 'user' ? 'Vista de la cámara frontal' : 'Vista de la cámara trasera'}
          style={mirrored ? undefined : { transform: 'none' }}
        />
      </div>

      {error ? (
        <div className="stack">
          <div className="notice error" role="alert">
            {error}
          </div>
          <button className="btn block" onClick={() => setAttempt((a) => a + 1)}>
            Intentar de nuevo
          </button>
        </div>
      ) : (
        <>
          <p className="prompt" aria-live="polite">
            {prompts[step]}
          </p>
          <div className="steps" aria-hidden="true">
            {ORDER.map((s, i) => (
              <span key={s} className={i <= reached && step !== 'loading' ? 'on' : ''} />
            ))}
          </div>
          {allowManual && (
            <button
              className="btn primary block"
              disabled={!ready || step === 'done'}
              onClick={() => {
                manual.current.requested = true;
              }}
            >
              {ready ? 'Tomar foto' : 'Esperando un rostro…'}
            </button>
          )}
          <p className="hint">{hint}</p>
          {DEBUG && debug && (
            <p className="hint" style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8rem' }}>
              {debug.fps} cuadros/s, rostros {debug.faces}, tamaño {debug.ratio} (mín. {profile.minFaceRatio}), calidad {debug.score}, vida{' '}
              {debug.live}, real {debug.real}, ojos {debug.ear ?? '–'} / {debug.baseline ?? '–'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
