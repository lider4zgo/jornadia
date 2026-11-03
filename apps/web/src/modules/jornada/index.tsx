import { useEffect } from 'react';
import { can } from '../../lib/access';
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
  if (!me.jornada?.face) {
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

  const tab = section === 'historial' ? 'historial' : 'checar';
  return (
    <>
      {tab === 'checar' ? <Checar me={me} onPunched={() => void reload()} /> : <History me={me} />}
      <nav className="tabbar" aria-label="Navegación">
        <button aria-current={tab === 'checar' ? 'page' : undefined} onClick={() => navigate('/jornada')}>
          Checar
        </button>
        <button aria-current={tab === 'historial' ? 'page' : undefined} onClick={() => navigate('/jornada/historial')}>
          Mi historial
        </button>
      </nav>
    </>
  );
}
