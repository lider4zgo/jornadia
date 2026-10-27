import { useEffect, useRef, useState } from 'react';
import { openCamera, runFaceCheck, type CheckResult, type CheckStep } from '../lib/face';

const PROMPTS: Record<CheckStep, string> = {
  loading: 'Preparando la cámara',
  position: 'Coloca tu rostro en el óvalo',
  closer: 'Acércate un poco más',
  'one-face': 'Solo debe aparecer una persona',
  blink: 'Ahora parpadea',
  hold: 'Quédate quieto',
  done: 'Listo',
};

const ORDER: CheckStep[] = ['position', 'blink', 'hold', 'done'];

interface Props {
  title: string;
  reference: number[] | null;
  onDone: (result: CheckResult) => void;
  onCancel: () => void;
}

/** Pantalla completa de cámara con el reto de parpadeo. */
export function Capture({ title, reference, onDone, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [step, setStep] = useState<CheckStep>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let stream: MediaStream | null = null;
    setError(null);
    setStep('loading');
    (async () => {
      try {
        stream = await openCamera(videoRef.current!);
        const result = await runFaceCheck(videoRef.current!, { reference, onStep: setStep, signal: controller.signal });
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

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <button className="btn quiet" onClick={onCancel}>
          Cancelar
        </button>
      </header>

      <div className="viewfinder" data-step={step}>
        <video ref={videoRef} playsInline muted aria-label="Vista de la cámara frontal" />
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
            {PROMPTS[step]}
          </p>
          <div className="steps" aria-hidden="true">
            {ORDER.map((s, i) => (
              <span key={s} className={i <= reached && step !== 'loading' ? 'on' : ''} />
            ))}
          </div>
          <p className="hint">
            {step === 'loading'
              ? 'La primera vez puede tardar unos segundos en preparar la verificación.'
              : 'Busca luz de frente. Quítate gorra y lentes oscuros.'}
          </p>
        </>
      )}
    </div>
  );
}
