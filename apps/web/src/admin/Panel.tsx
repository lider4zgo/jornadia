import { useState } from 'react';
import type { Me } from '../types';
import { Today } from './Today';
import { Report } from './Report';
import { People } from './People';
import { Sites } from './Sites';

type Tab = 'today' | 'report' | 'people' | 'sites';

const LABELS: Record<Tab, string> = { today: 'Hoy', report: 'Reporte', people: 'Personal', sites: 'Obras' };

/** Panel del cliente. El supervisor solo ve Hoy y Reporte (de sus obras). */
export function Panel({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const tabs: Tab[] = me.role === 'supervisor' ? ['today', 'report'] : ['today', 'report', 'people', 'sites'];
  const [tab, setTab] = useState<Tab>('today');

  return (
    <>
      <nav className="panel-nav" aria-label="Secciones">
        {tabs.map((t) => (
          <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {LABELS[t]}
          </button>
        ))}
      </nav>
      <div style={{ paddingTop: 18 }}>
        {tab === 'today' && <Today me={me} />}
        {tab === 'report' && <Report me={me} />}
        {tab === 'people' && <People me={me} onChanged={onChanged} />}
        {tab === 'sites' && <Sites me={me} onChanged={onChanged} />}
      </div>
    </>
  );
}
