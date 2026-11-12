import { useEffect } from 'react';
import { can } from '../../lib/access';
import { navigate } from '../../lib/router';
import type { ModuleProps } from '..';
import { Ausencias } from './Ausencias';
import { Empresa } from './Empresa';
import { Expedientes } from './Expedientes';
import { Organigrama } from './Organigrama';
import { Portal } from './Portal';

type Tab = 'expedientes' | 'organigrama' | 'ausencias' | 'empresa';
const LABELS: Record<Tab, string> = { expedientes: 'Expedientes', organigrama: 'Organigrama', ausencias: 'Vacaciones y ausencias', empresa: 'Empresa' };

/**
 * RH básico. Quien administra personal ve expedientes, organigrama, ausencias y los datos de
 * la empresa; el colaborador (y el supervisor) ven su portal.
 */
export default function RhModule({ me, section, reload }: ModuleProps) {
  const tabs = (
    [
      ['expedientes', can(me, 'rh.expediente.ver')],
      ['organigrama', can(me, 'rh.estructura.gestionar', 'rh.expediente.ver')],
      ['ausencias', can(me, 'rh.ausencias.aprobar')],
      ['empresa', can(me, 'core.empresa.editar')],
    ] as [Tab, boolean][]
  )
    .filter(([, ok]) => ok)
    .map(([t]) => t);
  const tab = tabs.find((t) => t === section) ?? tabs[0];

  useEffect(() => {
    if (tab && tab !== section) navigate(`/rh/${tab}`, { replace: true });
  }, [tab, section]);

  if (!tab) return <Portal me={me} section={section} />;
  const pending = me.rh?.pendingLeaves ?? 0;
  return (
    <>
      <nav className="panel-nav" aria-label="Secciones">
        {tabs.map((t) => (
          <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => navigate(`/rh/${t}`)}>
            {LABELS[t]}
            {t === 'ausencias' && pending > 0 ? ` (${pending})` : ''}
          </button>
        ))}
      </nav>
      <div className="content wide-content" style={{ paddingTop: 18 }}>
        {tab === 'expedientes' && <Expedientes me={me} />}
        {tab === 'organigrama' && <Organigrama me={me} />}
        {tab === 'ausencias' && <Ausencias me={me} onChanged={() => void reload()} />}
        {tab === 'empresa' && <Empresa me={me} />}
      </div>
    </>
  );
}
