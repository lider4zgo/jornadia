import { useState } from 'react';
import { api, ApiError, NetworkError } from '../lib/api';
import { faceModelVersion, type CheckResult } from '../lib/face';
import { toCompressedJpeg } from '../lib/image';
import { Capture } from '../screens/Capture';

interface Props {
  employee: { id: string; full_name: string; employee_number: string };
  onClose: () => void;
  onEnrolled: () => void;
}

/**
 * Foto de registro tomada en persona: el supervisor o administrador apunta la
 * cámara de su celular al trabajador. Esta foto es la referencia contra la que
 * se compara cada selfie de checada.
 */
export function EnrollFace({ employee, onClose, onEnrolled }: Props) {
  const [step, setStep] = useState<'intro' | 'capture' | 'saving'>('intro');
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  async function save(result: CheckResult) {
    setStep('saving');
    setError(null);
    if (!result.livenessPassed) {
      setError('No se confirmó que la persona esté frente a la cámara. Busca mejor luz y vuelve a intentar.');
      setStep('intro');
      return;
    }
    try {
      const photo = await toCompressedJpeg(result.frame, 480, 120_000);
      const form = new FormData();
      form.set(
        'data',
        JSON.stringify({ descriptor: result.embedding, model_version: await faceModelVersion(), liveness_passed: result.livenessPassed }),
      );
      form.set('photo', new File([photo], 'face.jpg', { type: 'image/jpeg' }));
      await api(`/api/admin/employees/${employee.id}/face`, { body: form, timeoutMs: 40000 });
      onEnrolled();
    } catch (err) {
      setError(
        err instanceof NetworkError ? 'Sin conexión. La foto de registro necesita internet.' : err instanceof ApiError ? err.message : 'No se pudo guardar la foto.',
      );
      setStep('intro');
    }
  }

  if (step === 'capture') {
    return (
      <Capture
        title={`Foto de ${employee.full_name.split(' ')[0]}`}
        reference={null}
        facing={facingMode}
        onDone={(r) => void save(r)}
        onCancel={() => setStep('intro')}
      />
    );
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-labelledby="enroll-title">
      <div className="sheet" style={{ width: 'min(100%, 460px)' }}>
        <h2 id="enroll-title">Foto de registro de {employee.full_name}</h2>
        <p>
          Tómala frente a la persona, con la cámara de tu celular. Será la referencia para verificar su rostro cada vez que cheque.
        </p>
        <ul className="stack muted" style={{ margin: 0, paddingLeft: 20 }}>
          <li>Confirma que es la persona correcta (número {employee.employee_number}).</li>
          <li>Luz de frente; sin gorra, casco ni lentes oscuros.</li>
          <li>Pídele que mire a la cámara y parpadee cuando se le indique.</li>
        </ul>
        <div className="segmented" role="group" aria-label="Cámara">
          <button type="button" aria-pressed={facingMode === 'environment'} onClick={() => setFacingMode('environment')}>
            Cámara trasera
          </button>
          <button type="button" aria-pressed={facingMode === 'user'} onClick={() => setFacingMode('user')}>
            Cámara frontal
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Con la trasera tú apuntas al trabajador. Con la frontal, él mira la pantalla mientras tú supervisas.
        </p>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="toolbar">
          <button className="btn solid" onClick={() => setStep('capture')} disabled={step === 'saving'}>
            {step === 'saving' ? 'Guardando…' : 'Abrir cámara'}
          </button>
          <button className="btn quiet" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
