import { useEffect, useState } from 'react';
import type { WorkerDoc } from '@korporia/core';
import { api, ApiError } from '../lib/api';
import { Modal, PinPrompt, Spinner } from '../common';
import type { WorkerDocKey, WorkerState } from '../types';

interface DocsState {
  pending: WorkerDocKey[];
  biometric: WorkerState['biometric'];
  usesJornada: boolean;
  docs: { aviso: WorkerDoc; avisoCompleto: WorkerDoc; acuerdo: WorkerDoc | null; biometria: WorkerDoc | null };
}

/** Un documento con sus párrafos y viñetas (partes en negritas). */
export function DocText({ doc, hideTitle = false }: { doc: WorkerDoc; hideTitle?: boolean }) {
  const rich = (parts: (string | { b: string })[]) => parts.map((p, i) => (typeof p === 'string' ? p : <strong key={i}>{p.b}</strong>));
  return (
    <div className="doc-text">
      {!hideTitle && <h3>{doc.title}</h3>}
      {doc.sections.map((s, i) => (
        <section key={i}>
          {s.title && <h4>{s.title}</h4>}
          {s.bullets && (
            <ul>
              {s.bullets.map((b, j) => (
                <li key={j}>{rich(b)}</li>
              ))}
            </ul>
          )}
          {s.paragraphs?.map((p, j) => <p key={j}>{rich(p)}</p>)}
        </section>
      ))}
    </div>
  );
}

/**
 * Primer ingreso del trabajador (y cada vez que cambie la versión de un documento):
 * aviso de privacidad → acuerdo de registro de jornada → consentimiento biométrico (opcional),
 * en ese orden, y firma con su PIN (Legal).
 */
export function WorkerDocs({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  const [state, setState] = useState<DocsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullNotice, setFullNotice] = useState(false);
  const [readNotice, setReadNotice] = useState(false);
  const [agree, setAgree] = useState(false);
  const [biometric, setBiometric] = useState<'autorizo' | 'no_autorizo' | null>(null);
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    api<DocsState>('/api/core/my/documents')
      .then(setState)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar tus documentos. Revisa tu conexión.'));
  }, []);

  if (error) {
    return (
      <div className="content" style={{ paddingTop: 24 }}>
        <div className="notice error">{error}</div>
        <button className="btn quiet block" onClick={onSignOut}>
          Salir
        </button>
      </div>
    );
  }
  if (!state) return <Spinner label="Cargando tus documentos…" />;

  const needs = (d: WorkerDocKey) => state.pending.includes(d);
  const ready = (!needs('aviso_trabajadores') || readNotice) && (!needs('acuerdo_jornada') || agree) && (!needs('biometria') || biometric);

  async function sign(pin: string) {
    setBusy(true);
    setPinError(null);
    try {
      await api('/api/core/my/documents/sign', {
        body: {
          accept: [...(readNotice ? ['aviso_trabajadores'] : []), ...(agree ? ['acuerdo_jornada'] : [])],
          biometric,
          pin,
        },
      });
      setSigning(false);
      onDone();
    } catch (err) {
      setPinError(err instanceof ApiError ? err.message : 'No se pudo firmar. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="content" style={{ paddingBottom: 48 }}>
      <h1>Antes de empezar</h1>
      <p className="muted">
        {state.pending.length === 1 && !needs('aviso_trabajadores')
          ? 'Hay un documento por firmar.'
          : 'Lee y firma estos documentos. Los firmas con tu PIN y quedan guardados con la fecha y la versión.'}
      </p>

      {needs('aviso_trabajadores') && (
        <section className="sheet stack">
          <span className="eyebrow">1 · Aviso de privacidad</span>
          <DocText doc={state.docs.aviso} />
          <button type="button" className="btn small" onClick={() => setFullNotice(true)}>
            Leer el aviso completo
          </button>
          <label className="check">
            <input type="checkbox" checked={readNotice} onChange={(e) => setReadNotice(e.target.checked)} />
            <span>Leí el aviso de privacidad</span>
          </label>
        </section>
      )}

      {needs('acuerdo_jornada') && state.docs.acuerdo && (
        <section className="sheet stack">
          <span className="eyebrow">2 · Registro de jornada</span>
          <DocText doc={state.docs.acuerdo} />
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              <strong>Estoy de acuerdo</strong>
            </span>
          </label>
        </section>
      )}

      {needs('biometria') && state.docs.biometria && (
        <section className="sheet stack">
          <span className="eyebrow">3 · Uso de tu rostro (opcional)</span>
          <DocText doc={state.docs.biometria} />
          <div className="stack" role="radiogroup" aria-label="Uso de mi rostro" style={{ gap: 8 }}>
            <label className="check">
              <input type="radio" name="bio" checked={biometric === 'autorizo'} onChange={() => setBiometric('autorizo')} />
              <span>
                <strong>Sí autorizo</strong> el uso de mi rostro
              </span>
            </label>
            <label className="check">
              <input type="radio" name="bio" checked={biometric === 'no_autorizo'} onChange={() => setBiometric('no_autorizo')} />
              <span>
                <strong>No autorizo</strong>; prefiero registrar con PIN
              </span>
            </label>
          </div>
        </section>
      )}

      <button className="btn solid block" disabled={!ready} onClick={() => setSigning(true)}>
        Firmar con mi PIN
      </button>
      <button className="btn quiet block" onClick={onSignOut}>
        Salir
      </button>

      {fullNotice && (
        <Modal title={state.docs.avisoCompleto.title} onClose={() => setFullNotice(false)} width={640}>
          <DocText doc={state.docs.avisoCompleto} hideTitle />
          <button className="btn block" onClick={() => setFullNotice(false)}>
            Cerrar
          </button>
        </Modal>
      )}
      {signing && (
        <PinPrompt
          title="Firmar"
          hint="Al escribir tu PIN firmas los documentos que marcaste."
          confirmLabel="Firmar"
          busy={busy}
          error={pinError}
          onSubmit={(pin) => void sign(pin)}
          onCancel={() => setSigning(false)}
        />
      )}
    </div>
  );
}

/** "Mi privacidad": aviso completo y autorizar o retirar el uso del rostro. */
export function MyPrivacy({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<DocsState | null>(null);
  const [asking, setAsking] = useState<'autorizo' | 'retiro' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api<DocsState>('/api/core/my/documents').then(setState).catch(() => setError('No se pudo cargar. Revisa tu conexión.'));
  }, []);

  async function change(choice: 'autorizo' | 'retiro', pin: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await api<DocsState>('/api/core/my/biometric', { body: { choice, pin } });
      setState(next);
      setAsking(null);
      setDone(
        choice === 'retiro'
          ? 'Listo. Retiraste tu consentimiento: borramos tu foto de registro y desde ahora checas con tu PIN.'
          : 'Listo. Autorizaste el uso de tu rostro. Pide a tu supervisor que te tome la foto de registro.',
      );
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <div className="content">{error ? <div className="notice error">{error}</div> : <p className="muted">Cargando…</p>}</div>;
  const authorized = state.biometric === 'autorizo';

  return (
    <div className="content stack">
      <h1>Mi privacidad</h1>
      {done && <div className="notice ok">{done}</div>}
      {state.usesJornada && (
        <section className="sheet stack">
          <h2>Uso de tu rostro</h2>
          <p>
            {authorized
              ? 'Autorizaste que tu selfie y la comparación de tu rostro se usen para confirmar que eres tú al checar.'
              : 'No usas tu rostro: checas con tu PIN y tu ubicación. No se toma ninguna foto.'}
          </p>
          <button className={`btn block ${authorized ? 'danger' : ''}`} onClick={() => setAsking(authorized ? 'retiro' : 'autorizo')}>
            {authorized ? 'Retirar mi consentimiento' : 'Autorizar el uso de mi rostro'}
          </button>
          <p className="muted" style={{ margin: 0 }}>Es tu decisión y no tiene ninguna consecuencia en tu trabajo.</p>
        </section>
      )}
      <section className="sheet">
        <DocText doc={state.docs.avisoCompleto} />
      </section>
      {asking && (
        <PinPrompt
          title={asking === 'retiro' ? 'Retirar consentimiento' : 'Autorizar uso de mi rostro'}
          hint={asking === 'retiro' ? 'Se borrará tu foto de registro y checarás con tu PIN.' : undefined}
          busy={busy}
          error={error}
          onSubmit={(pin) => void change(asking, pin)}
          onCancel={() => setAsking(null)}
        />
      )}
    </div>
  );
}
