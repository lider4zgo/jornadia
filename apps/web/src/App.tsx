import { Suspense, useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, ApiError, NetworkError, setActiveCompany } from './lib/api';
import { canEnterModule } from './lib/access';
import { syncClock } from './lib/clock';
import { navigate, splitPath, usePath } from './lib/router';
import { isConfigured, openedFromRecoveryLink, supabase } from './lib/supabase';
import { Mark, Spinner, WhatsAppLink } from './common';
import { Login } from './core/Login';
import { SetPassword } from './core/SetPassword';
import { CreateCompany } from './core/CreateCompany';
import { WEB_MODULES } from './modules';
import { listQueue } from './modules/jornada/lib/queue';
import type { Me } from './types';

const meCacheKey = (userId: string) => `korporia-me-${userId}`;

/** Shell de Korporia: sesión, empresa activa y navegación entre módulos. */
export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(openedFromRecoveryLink);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const loadMe = useCallback(async () => {
    if (!session) return;
    const started = Date.now();
    try {
      const data = await api<Me>('/api/core/me');
      syncClock(data.serverTime, started);
      setActiveCompany(data.company?.id ?? null);
      localStorage.setItem(meCacheKey(session.user.id), JSON.stringify(data));
      setMe(data);
      setLoadError(null);
    } catch (err) {
      // Sin señal: se abre con los datos guardados de la última vez
      const cached = localStorage.getItem(meCacheKey(session.user.id));
      if (err instanceof NetworkError && cached) {
        const data = JSON.parse(cached) as Me;
        setActiveCompany(data.company?.id ?? null);
        setMe(data);
      } else {
        setLoadError(err instanceof ApiError ? err.message : 'No se pudo conectar. Revisa tu señal e intenta de nuevo.');
      }
    }
  }, [session]);

  useEffect(() => {
    setMe(null);
    if (session) void loadMe();
  }, [session, loadMe]);

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
          <p>Crea el archivo apps/web/.env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver .env.example).</p>
        </div>
      </div>
    );
  }
  if (session === undefined) return <Spinner label="Abriendo Korporia…" />;
  if (recovering && session) return <SetPassword onDone={() => setRecovering(false)} />;
  if (!session) return <Login />;
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

  return <Shell me={me} email={session.user.email} reload={loadMe} signOut={signOut} />;
}

function Shell({ me, email, reload, signOut }: { me: Me; email?: string; reload: () => Promise<void>; signOut: () => Promise<void> }) {
  const path = usePath();
  const [moduleKey, section] = splitPath(path);
  const available = WEB_MODULES.filter((m) => canEnterModule(me, m.key));
  const current = available.find((m) => m.key === moduleKey) ?? available[0];

  // Ruta sin módulo o de un módulo no disponible: ir al primero que el usuario puede usar
  useEffect(() => {
    if (current && current.key !== moduleKey) navigate(`/${current.key}`, { replace: true });
  }, [current, moduleKey]);

  // El colaborador (sin permisos de gestión) usa la vista angosta de celular
  const manages = me.permissions.some((p) => p !== 'jornada.checar');
  const wide = manages || (me.isPlatformAdmin && !me.company);

  return (
    <div className={`shell ${wide ? 'wide' : ''}`}>
      <header className="topbar">
        <Mark />
        <div className="who">
          <strong>{me.company?.name ?? 'Korporia'}</strong>
          <span>{me.employee?.full_name ?? (me.isPlatformAdmin ? 'Administrador de la plataforma' : email)}</span>
        </div>
        {available.length > 1 && (
          <nav className="module-nav" aria-label="Módulos">
            {available.map((m) => (
              <button key={m.key} aria-current={m.key === current?.key ? 'page' : undefined} onClick={() => navigate(`/${m.key}`)}>
                {m.name}
              </button>
            ))}
          </nav>
        )}
        <WhatsAppLink number={me.company?.whatsapp_support} text={`Hola, necesito ayuda con Korporia (${me.company?.name ?? ''}).`} />
        <button className="btn quiet" onClick={() => void signOut()}>
          Salir
        </button>
      </header>
      <Body me={me} current={current?.key} section={current?.key === moduleKey ? section : ''} reload={reload} />
    </div>
  );
}

function Body({ me, current, section, reload }: { me: Me; current?: string; section: string; reload: () => Promise<void> }) {
  if (me.isPlatformAdmin && !me.company) return <CreateCompany onCreated={() => void reload()} />;
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
