import { useEffect } from 'react';
import { can } from '../../../lib/access';
import { navigate } from '../../../lib/router';
import type { Me } from '../../../types';
import { Today } from './Today';
import { Report } from './Report';
import { People } from './People';
import { Sites } from './Sites';
import { Schedules } from './Schedules';

type Tab = 'hoy' | 'reporte' | 'personal' | 'horarios' | 'obras';

const LABELS: Record<Tab, string> = { hoy: 'Hoy', reporte: 'Reporte', personal: 'Personal', horarios: 'Horarios', obras: 'Obras' };

/** Panel del módulo Jornada. Cada pestaña aparece según los permisos del usuario. */
export function Panel({ me, section, onChanged }: { me: Me; section: string; onChanged: () => void }) {
  const tabs = (
    [
      ['hoy', can(me, 'jornada.asistencia.ver', 'jornada.asistencia.ver_asignadas')],
      ['reporte', can(me, 'jornada.reportes.ver')],
      ['personal', can(me, 'core.personal.ver')],
      ['horarios', can(me, 'jornada.configurar')],
      ['obras', can(me, 'core.sitios.gestionar')],
    ] as [Tab, boolean][]
  )
    .filter(([, allowed]) => allowed)
    .map(([t]) => t);
  const tab = tabs.find((t) => t === section) ?? tabs[0];

  useEffect(() => {
    if (tab && tab !== section) navigate(`/jornada/${tab}`, { replace: true });
  }, [tab, section]);

  return (
    <>
      <nav className="panel-nav" aria-label="Secciones">
        {tabs.map((t) => (
          <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => navigate(`/jornada/${t}`)}>
            {LABELS[t]}
          </button>
        ))}
      </nav>
      <div style={{ paddingTop: 18 }}>
        {tab === 'hoy' && <Today me={me} />}
        {tab === 'reporte' && <Report me={me} />}
        {tab === 'personal' && <People me={me} onChanged={onChanged} />}
        {tab === 'horarios' && <Schedules me={me} />}
        {tab === 'obras' && <Sites me={me} onChanged={onChanged} />}
      </div>
    </>
  );
}
