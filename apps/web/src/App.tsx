import { Suspense, useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, ApiError, NetworkError, setActiveCompany } from './lib/api';
import { canEnterModule } from './lib/access';
import { syncClock } from './lib/clock';
import { navigate, splitPath, usePath } from './lib/router';
import { applyUpdate, useUpdateAvailable } from './lib/update';
import { isConfigured, openedFromRecoveryLink, supabase } from './lib/supabase';
import { LegalFooter, Mark, Modal, Spinner, SUPPORT_EMAIL, WhatsAppLink } from './common';
import { DeviceGate, EmailCodeStep } from './core/DeviceGate';
import { MyProfile } from './core/MyProfile';
import { ImportPeople } from './core/ImportPeople';
import { setStepUpHandler } from './lib/trust';
import { Login } from './core/Login';
import { CreateCompany } from './core/CreateCompany';
import { CompleteSignup, Signup } from './core/Signup';
import { WorkerDocs } from './core/WorkerDocs';
import { PlanBanner } from './core/PlanBanner';
import { PlatformCompanies } from './core/PlatformCompanies';
import { PlatformReferrals } from './core/PlatformReferrals';
import { WEB_MODULES } from './modules';
import { listQueue } from './modules/jornada/lib/queue';
import type { Me } from './types';

const meCacheKey = (userId: string) => `korporia-me-${userId}`;

/** Shell de Korporia: sesión, empresa activa y navegación entre módulos. */
export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsDevice, setNeedsDevice] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Supabase vuelve a anunciar la sesión al regresar a la pestaña o al renovar el token.
  // Solo se recarga todo si cambia el USUARIO; así no se pierde lo que se estaba capturando.
  const userId = session?.user.id;

  const loadMe = useCallback(async () => {
    if (!userId) return;
    const started = Date.now();
    try {
      const data = await api<Me>('/api/core/me');
      syncClock(data.serverTime, started);
      setActiveCompany(data.company?.id ?? null);
      localStorage.setItem(meCacheKey(userId), JSON.stringify(data));
      setMe(data);
      setLoadError(null);
      setNeedsDevice(false);
    } catch (err) {
      // Administrador en un dispositivo nuevo o sin contraseña: segundo paso por correo
      if (err instanceof ApiError && err.code === 'device_verify') {
        setNeedsDevice(true);
        return;
      }
      // Sin señal: se abre con los datos guardados de la última vez
      const cached = localStorage.getItem(meCacheKey(userId));
      if (err instanceof NetworkError && cached) {
        const data = JSON.parse(cached) as Me;
        setActiveCompany(data.company?.id ?? null);
        setMe(data);
      } else {
        setLoadError(err instanceof ApiError ? err.message : 'No se pudo conectar. Revisa tu señal e intenta de nuevo.');
      }
    }
  }, [userId]);

  useEffect(() => {
    setMe(null);
    void loadMe();
  }, [loadMe]);

  async function signOut() {
    const pending = (await listQueue()).filter((q) => !q.rejected).length;
    if (pending && !confirm(`Tienes ${pending} checada(s) sin enviar. Si cierras sesión podrían perderse. ¿Salir de todos modos?`)) return;
    if (session) localStorage.removeItem(meCacheKey(session.user.id));
    await supabase.auth.signOut();
  }

  if (!isConfigured) {
    return (
      <div className="shell">
        <div className="content" style={{ paddingTop: 32 }}>
          <h1>Falta configurar Korporia</h1>
          <p>Crea el archivo apps/web/.env.local con VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY (ver .env.example).</p>
        </div>
      </div>
    );
  }
  if (session === undefined) return <Spinner label="Abriendo Korporia…" />;
  if (!session) return <SignedOut />;
  if (needsDevice) {
    // Limpia el enlace de recuperación de la barra de direcciones, si lo hubo
    if (openedFromRecoveryLink) window.history.replaceState(null, '', window.location.pathname);
    return <DeviceGate userId={session.user.id} onVerified={() => void loadMe()} onSignOut={() => void signOut()} />;
  }
  if (loadError) {
    return (
      <div className="shell">
        <div className="content" style={{ paddingTop: 32 }}>
          <div className="notice error">{loadError}</div>
          <button className="btn block" onClick={() => void loadMe()}>
            Intentar de nuevo
          </button>
          <button className="btn quiet block" onClick={() => void signOut()}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }
  if (!me) return <Spinner label="Cargando tu información…" />;

  // Sesión iniciada sin empresa: termina el registro (Korporia Starter)
  if (!me.isPlatformAdmin && me.companies.length === 0) {
    return (
      <div className="shell">
        <CompleteSignup me={me} onDone={loadMe} onSignOut={() => void signOut()} />
      </div>
    );
  }

  // Trabajador: firma el aviso, el acuerdo de jornada y su decisión biométrica antes de usar la app
  if (me.worker && me.worker.pending.length > 0) {
    return (
      <div className="shell">
        <WorkerDocs onDone={() => void loadMe()} onSignOut={() => void signOut()} />
      </div>
    );
  }

  return <Shell me={me} email={session.user.email} reload={loadMe} signOut={signOut} />;
}

/** Sin sesión: registro (/registro) o inicio de sesión. */
function SignedOut() {
  const path = usePath();
  return path === '/registro' ? <Signup /> : <Login />;
}

function Shell({ me, email, reload, signOut }: { me: Me; email?: string; reload: () => Promise<void>; signOut: () => Promise<void> }) {
  const path = usePath();
  const [moduleKey, section] = splitPath(path);
  const available = WEB_MODULES.filter((m) => canEnterModule(me, m.key));
  const onImport = moduleKey === 'importar' && Boolean(me.company) && me.permissions.includes('core.personal.gestionar');
  const onProfile = (moduleKey === 'perfil' && !me.worker) || onImport;
  // Cambios sensibles: la API pide un código reciente y la app lo pide en una ventana
  const [stepUp, setStepUp] = useState<((ok: boolean) => void) | null>(null);
  useEffect(() => {
    setStepUpHandler(() => new Promise<boolean>((resolve) => setStepUp(() => resolve)));
    return () => setStepUpHandler(null);
  }, []);
  const finishStepUp = (ok: boolean) => {
    stepUp?.(ok);
    setStepUp(null);
  };
  const current = available.find((m) => m.key === moduleKey) ?? available[0];

  // Ruta sin módulo o de un módulo no disponible: ir al primero que el usuario puede usar
  useEffect(() => {
    if (!onProfile && current && current.key !== moduleKey) navigate(`/${current.key}`, { replace: true });
  }, [current, moduleKey, onProfile]);

  // El colaborador (sin permisos de gestión) usa la vista angosta de celular
  const SELF_SERVICE = ['jornada.checar', 'jornada.registros.propios', 'rh.portal.ver', 'rh.portal.solicitar'];
  const manages = me.permissions.some((p) => !SELF_SERVICE.includes(p));
  const wide = manages || (me.isPlatformAdmin && !me.company);

  return (
    <div className={`shell ${wide ? 'wide' : ''}`}>
      <header className="topbar">
        <Mark />
        {me.worker ? (
          <div className="who">
            <strong>{me.company?.name ?? 'Korporia'}</strong>
            <span>{me.employee?.full_name ?? email}</span>
          </div>
        ) : (
          <button className="who who-link" onClick={() => navigate('/perfil')} title="Mi perfil">
            <strong>{me.company?.name ?? 'Korporia'}</strong>
            <span>{me.employee?.full_name ?? (me.isPlatformAdmin && !me.company ? 'Administrador de la plataforma' : email)} · Mi perfil</span>
          </button>
        )}
        {available.length > 1 && (
          <nav className="module-nav" aria-label="Módulos">
            {available.map((m) => (
              <button key={m.key} aria-current={m.key === current?.key ? 'page' : undefined} onClick={() => navigate(`/${m.key}`)}>
                {m.label?.(me) ?? m.name}
              </button>
            ))}
          </nav>
        )}
        {/* T-09: Korporia Starter no tiene soporte por WhatsApp; su ayuda es por correo y el centro de ayuda */}
        {me.company?.subscription?.plan === 'starter' ? (
          <a className="btn quiet" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Ayuda con Korporia (${me.company.name})`)}`}>
            Ayuda
          </a>
        ) : (
          <WhatsAppLink number={me.company?.whatsapp_support} text={`Hola, necesito ayuda con Korporia (${me.company?.name ?? ''}).`} />
        )}
        <button className="btn quiet" onClick={() => void signOut()}>
          Salir
        </button>
      </header>
      <UpdateBanner />
      <PlanBanner me={me} />
      {onImport ? (
        <ImportPeople me={me} />
      ) : onProfile ? (
        <MyProfile me={me} onSaved={() => void reload()} />
      ) : (
        <Body me={me} current={current?.key} section={current?.key === moduleKey ? section : ''} reload={reload} />
      )}
      <LegalFooter />
      {stepUp && (
        <Modal title="Confirma el cambio" onClose={() => finishStepUp(false)}>
          <EmailCodeStep
            framed={false}
            email={email ?? ''}
            purpose="sensitive"
            title="Confirma el cambio"
            intro="Para este cambio necesitamos confirmar que eres tú. Te enviamos un código a tu correo."
            onVerified={() => finishStepUp(true)}
            onCancel={() => finishStepUp(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function Body({ me, current, section, reload }: { me: Me; current?: string; section: string; reload: () => Promise<void> }) {
  if (me.isPlatformAdmin && !me.company) {
    return (
      <>
        <CreateCompany onCreated={() => void reload()} />
        <div className="content">
          <PlatformCompanies />
          <PlatformReferrals />
        </div>
      </>
    );
  }
  if (!me.company) {
    return (
      <div className="content">
        <div className="notice warn">Tu usuario no está asignado a ninguna empresa. Pide a tu administrador que te dé de alta.</div>
      </div>
    );
  }
  const module = WEB_MODULES.find((m) => m.key === current);
  if (!module) {
    const status = me.company.subscription?.status;
    const message =
      status === 'suspended' || status === 'archived'
        ? 'La cuenta de tu empresa está suspendida. Avisa al dueño de la cuenta para reactivarla.'
        : 'Tu usuario todavía no tiene acceso a ningún módulo. Pide a tu administrador que te asigne un rol.';
    return (
      <div className="content">
        <div className="notice warn">{message}</div>
      </div>
    );
  }
  const { Component } = module;
  return (
    <Suspense fallback={<Spinner label={`Abriendo ${module.name}…`} />}>
      <Component me={me} section={section} reload={reload} />
    </Suspense>
  );
}

/** Aviso de versión nueva: la app no se recarga sola para no perder lo que se está capturando. */
function UpdateBanner() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div className="notice update-banner" role="status">
      <span>Hay una versión nueva de Korporia.</span>
      <button className="btn small solid" onClick={applyUpdate}>
        Actualizar
      </button>
    </div>
  );
}
