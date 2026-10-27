import { useState } from 'react';
import { api, ApiError, NetworkError } from '../lib/api';
import { faceModelVersion, type CheckResult } from '../lib/face';
import { toCompressedJpeg } from '../lib/image';
import { Capture } from './Capture';
import type { Me } from '../types';

/** Primer uso: el trabajador registra la foto con la que se verificará su identidad. */
export function Enroll({ me, onEnrolled }: { me: Me; onEnrolled: () => void }) {
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(result: CheckResult) {
    setCapturing(false);
    if (!result.livenessPassed) {
      setError('No pudimos confirmar que eres una persona frente a la cámara. Busca mejor luz e intenta de nuevo.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const photo = await toCompressedJpeg(result.frame, 480, 120_000);
      const form = new FormData();
      form.set('data', JSON.stringify({ descriptor: result.embedding, model_version: await faceModelVersion() }));
      form.set('photo', new File([photo], 'face.jpg', { type: 'image/jpeg' }));
      await api('/api/me/face', { body: form, timeoutMs: 40000 });
      onEnrolled();
    } catch (err) {
      setError(
        err instanceof NetworkError
          ? 'Necesitas conexión a internet para registrar tu foto la primera vez.'
          : err instanceof ApiError
            ? err.message
            : 'No se pudo guardar tu foto.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content">
      <h1>Registra tu foto</h1>
      <p>
        Hola, {me.employee?.full_name.split(' ')[0]}. Antes de checar por primera vez, toma una foto de tu rostro. Cada vez que
        cheques, Jornadia comparará tu selfie con esta foto para confirmar que eres tú.
      </p>
      <div className="notice">
        <strong>Sobre tus datos</strong>
        {me.company?.name} usa tu foto, la hora y tu ubicación al checar solo para registrar tu jornada, como pide la Ley Federal del
        Trabajo. La ubicación se toma únicamente en el momento de checar. Las fotos se guardan protegidas y solo las ve personal
        autorizado de tu empresa.
      </div>
      <ul className="stack muted" style={{ margin: 0, paddingLeft: 20 }}>
        <li>Busca luz de frente, no a tus espaldas.</li>
        <li>Quítate gorra, casco y lentes oscuros.</li>
        <li>Cuando te lo pida, parpadea.</li>
      </ul>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button className="btn primary block" onClick={() => setCapturing(true)} disabled={saving}>
          {saving ? 'Guardando…' : 'Tomar mi foto'}
        </button>
      </div>
      {capturing && <Capture title="Foto de registro" reference={null} onDone={save} onCancel={() => setCapturing(false)} />}
    </div>
  );
}
