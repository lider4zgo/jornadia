import { Hono } from 'hono';
import { allowedNextKinds } from '@korporia/jornada';
import type { AppEnv } from '../../env';
import { adminClient, jornadaDb } from '../../lib/supabase';
import type { ApiModule } from '../types';
import { faces } from './faces';
import { files } from './files';
import { punches } from './punches';
import { reports } from './reports';

/** Korporia Jornada: registro electrónico de jornada con selfie, geocercas y modo sin conexión. */
const routes = new Hono<AppEnv>();
routes.route('/punches', punches);
routes.route('/reports', reports);
routes.route('/files', files);
routes.route('/employees', faces);

export const jornadaModule: ApiModule = {
  key: 'jornada',
  routes,

  /** Ajustes del módulo y, si el usuario es colaborador, su última checada y su referencia facial. */
  async me({ env, companyId, employee }) {
    const db = jornadaDb(adminClient(env));
    const settingsQuery = db.from('settings').select('weekly_hour_limit, weekly_limits, face_match_threshold, track_breaks').eq('company_id', companyId).maybeSingle();
    if (!employee) {
      const { data: settings } = await settingsQuery;
      return { settings, lastPunch: null, nextKinds: [], face: null, consentConfirmedAt: null };
    }
    const [{ data: settings }, { data: lastPunch }, { data: face }, { data: own }] = await Promise.all([
      settingsQuery,
      db
        .from('punches')
        .select('id, kind, server_ts, site_id')
        .eq('employee_id', employee.id)
        .order('server_ts', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from('faces').select('descriptor, model_version, enrolled_at, approved_at').eq('employee_id', employee.id).maybeSingle(),
      db.from('employee_settings').select('consent_confirmed_at').eq('employee_id', employee.id).maybeSingle(),
    ]);
    return {
      settings,
      lastPunch,
      nextKinds: allowedNextKinds(lastPunch?.kind ?? null),
      face,
      consentConfirmedAt: own?.consent_confirmed_at ?? null,
    };
  },

  /** Ajustes del colaborador en Jornada. El consentimiento biométrico lo firma él después. */
  async onEmployeeCreated(env, { employeeId, companyId }) {
    const { error } = await jornadaDb(adminClient(env)).from('employee_settings').insert({ employee_id: employeeId, company_id: companyId });
    if (error) throw error;
  },
};
