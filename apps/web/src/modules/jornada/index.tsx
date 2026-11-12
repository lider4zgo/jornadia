import { useEffect } from 'react';
import { can, writable } from '../../lib/access';
import { MyPrivacy } from '../../core/WorkerDocs';
import { navigate } from '../../lib/router';
import type { ModuleProps } from '..';
import { Panel } from './admin/Panel';
import { startAutoSync } from './lib/queue';
import { Checar } from './screens/Checar';
import { History } from './screens/History';

/**
 * Korporia Jornada en la web. Quien gestiona asistencia ve el panel;
 * el colaborador ve Checar y Mi historial.
 */
export default function JornadaModule({ me, section, reload }: ModuleProps) {
  const manages = can(me, 'jornada.asistencia.ver', 'jornada.asistencia.ver_asignadas', 'jornada.reportes.ver', 'jornada.rostros.registrar');
  if (manages) return <Panel me={me} section={section} onChanged={() => void reload()} />;
  return <Worker me={me} section={section} reload={reload} />;
}

function Worker({ me, section, reload }: ModuleProps) {
  // Envía solas las checadas guardadas sin señal en cuanto vuelve la conexión
  useEffect(() => startAutoSync(() => void reload()), [reload]);

  if (!me.employee) {
    return (
      <div className="content">
        <div className="notice warn">Tu usuario no tiene un registro de colaborador. Habla con tu supervisor.</div>
      </div>
    );
  }
  // Si el checador del plan terminó, el trabajador conserva sus registros y su privacidad
  const canPunch = writable(me, 'jornada') && can(me, 'jornada.checar');
  const tab = section === 'historial' || !canPunch ? (section === 'privacidad' ? 'privacidad' : 'historial') : section === 'privacidad' ? 'privacidad' : 'checar';
  return (
    <>
      {tab === 'checar' && <Checar me={me} onPunched={() => void reload()} />}
      {tab === 'historial' && <History me={me} />}
      {tab === 'privacidad' && <MyPrivacy onChanged={() => void reload()} />}
      <nav className="tabbar" aria-label="Navegación">
        {canPunch && (
          <button aria-current={tab === 'checar' ? 'page' : undefined} onClick={() => navigate('/jornada')}>
            Checar
          </button>
        )}
        <button aria-current={tab === 'historial' ? 'page' : undefined} onClick={() => navigate('/jornada/historial')}>
          Mis registros
        </button>
        <button aria-current={tab === 'privacidad' ? 'page' : undefined} onClick={() => navigate('/jornada/privacidad')}>
          Mi privacidad
        </button>
      </nav>
    </>
  );
}
