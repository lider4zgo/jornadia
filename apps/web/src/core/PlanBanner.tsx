import { PLAN_LABELS } from '@korporia/core';
import { can } from '../lib/access';
import { formatDate, serverNow } from '../lib/clock';
import { WhatsAppLink } from '../common';
import type { Me } from '../types';

const SALES = '528718963470';
const daysUntil = (iso: string) => Math.ceil((Date.parse(iso) - serverNow().getTime()) / 86_400_000);

/**
 * Aviso del plan para quien administra la cuenta: días que quedan de Korporia Starter
 * y qué pasa al terminar (Legal: checador al día 90, RH básico y solo lectura al mes 6).
 * A los colaboradores solo se les avisa cuando algo ya no está disponible.
 */
export function PlanBanner({ me }: { me: Me }) {
  const sub = me.company?.subscription;
  if (!sub || !me.company) return null;
  const tz = me.company.timezone;
  const admin = can(me, 'core.empresa.suscripcion');
  const readOnly = me.writable && !me.writable.includes('core');
  const clockOff = me.writable && me.modules.includes('jornada') && !me.writable.includes('jornada');

  if (readOnly) {
    const archiveOn = sub.read_only_at ? new Date(Date.parse(sub.read_only_at) + 90 * 86_400_000).toISOString() : null;
    return (
      <div className="notice warn plan-banner" role="status">
        <strong>Tu cuenta está en solo lectura</strong>
        {admin
          ? `Puedes consultar y exportar tu información${archiveOn ? ` hasta el ${formatDate(archiveOn, tz)}` : ''}. Contrata Jornada para seguir usando Korporia.`
          : 'Puedes consultar tu información, pero no hacer cambios. Avisa al administrador de tu empresa.'}
        {admin && <Contact me={me} />}
      </div>
    );
  }
  if (clockOff) {
    return (
      <div className="notice warn plan-banner" role="status">
        <strong>{admin ? 'El checador de Korporia Starter terminó' : 'El registro de jornada está desactivado'}</strong>
        {admin
          ? 'Tus registros siguen disponibles para consultar y exportar. RH básico sigue activo. Contrata Jornada para volver a registrar asistencia.'
          : 'Tus registros siguen disponibles en "Mis registros". Avisa al administrador de tu empresa.'}
        {admin && <Contact me={me} />}
      </div>
    );
  }
  if (sub.plan !== 'starter' || !admin || !sub.starter_clock_until) return null;
  const clockDays = daysUntil(sub.starter_clock_until);
  const urgent = clockDays <= 15;
  return (
    <div className={`notice ${urgent ? 'warn' : ''} plan-banner`} role="status">
      <strong>
        {PLAN_LABELS.starter}: checador {clockDays > 0 ? `${clockDays} día${clockDays === 1 ? '' : 's'} más` : 'termina hoy'}
      </strong>
      Checador completo hasta el {formatDate(sub.starter_clock_until, tz)}
      {sub.starter_hr_until ? ` y RH básico hasta el ${formatDate(sub.starter_hr_until, tz)}` : ''}. Hasta {sub.employee_limit} colaboradores y 1
      administrador.
      {urgent && <Contact me={me} />}
    </div>
  );
}

function Contact({ me }: { me: Me }) {
  return (
    <div style={{ marginTop: 8 }}>
      <WhatsAppLink number={SALES} text={`Hola, quiero contratar Korporia Jornada para ${me.company?.name ?? 'mi empresa'}.`} label="Contratar Jornada por WhatsApp" />
    </div>
  );
}
