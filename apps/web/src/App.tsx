import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, ApiError, NetworkError, setActiveCompany } from './lib/api';
import { syncClock } from './lib/clock';
import { listQueue, startAutoSync } from './lib/queue';
import { isConfigured, openedFromRecoveryLink, supabase } from './lib/supabase';
import { Mark, Spinner, WhatsAppLink } from './common';
import { Login } from './screens/Login';
import { SetPassword } from './screens/SetPassword';
import { Checar } from './screens/Checar';
import { History } from './screens/History';
import { Panel } from './admin/Panel';
import { CreateCompany } from './admin/CreateCompany';
import type { Me } from './types';

const meCacheKey = (userId: string) => `jornadia-me-${userId}`;

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
      const data = await api<Me>('/api/me');
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

  useEffect(() => {
    if (!session) return;
    return startAutoSync(() => void loadMe());
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
          <h1>Falta configurar Jornadia</h1>
          <p>Crea el archivo apps/web/.env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver .env.example).</p>
        </div>
      </div>
    );
  }
  if (session === undefined) return <Spinner label="Abriendo Jornadia…" />;
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

  const isManager = me.role === 'owner' || me.role === 'admin' || me.role === 'supervisor';
  const wide = isManager || (me.isPlatformAdmin && !me.company);

  return (
    <div className={`shell ${wide ? 'wide' : ''}`}>
      <header className="topbar">
        <Mark />
        <div className="who">
          <strong>{me.company?.name ?? 'Jornadia'}</strong>
          <span>{me.employee?.full_name ?? (me.isPlatformAdmin ? 'Administrador de la plataforma' : session.user.email)}</span>
        </div>
        <WhatsAppLink number={me.company?.whatsapp_support} text={`Hola, necesito ayuda con Jornadia (${me.company?.name ?? ''}).`} />
        <button className="btn quiet" onClick={() => void signOut()}>
          Salir
        </button>
      </header>
      <Body me={me} isManager={isManager} reload={loadMe} />
    </div>
  );
}

function Body({ me, isManager, reload }: { me: Me; isManager: boolean; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<'checar' | 'historial'>('checar');

  if (me.isPlatformAdmin && !me.company) return <CreateCompany onCreated={() => void reload()} />;
  if (!me.company) {
    return (
      <div className="content">
        <div className="notice warn">Tu usuario no está asignado a ninguna empresa. Pide a tu administrador que te dé de alta.</div>
      </div>
    );
  }
  if (isManager) return <Panel me={me} onChanged={() => void reload()} />;
  if (!me.employee) {
    return (
      <div className="content">
        <div className="notice warn">Tu usuario no tiene un registro de trabajador. Habla con tu supervisor.</div>
      </div>
    );
  }
  if (!me.face) {
    return (
      <div className="content">
        <div className="notice warn">
          <strong>Falta tu foto de registro</strong>
          Pide a tu supervisor que te tome la foto desde su celular. Después podrás checar desde aquí.
        </div>
        <button className="btn block" onClick={() => void reload()}>
          Ya me la tomaron
        </button>
      </div>
    );
  }

  return (
    <>
      {tab === 'checar' ? <Checar me={me} onPunched={() => void reload()} /> : <History me={me} />}
      <nav className="tabbar" aria-label="Navegación">
        <button aria-current={tab === 'checar' ? 'page' : undefined} onClick={() => setTab('checar')}>
          Checar
        </button>
        <button aria-current={tab === 'historial' ? 'page' : undefined} onClick={() => setTab('historial')}>
          Mi historial
        </button>
      </nav>
    </>
  );
}
