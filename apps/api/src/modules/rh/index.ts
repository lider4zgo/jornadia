import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { requireAuth } from '../../lib/auth';
import { adminClient, rhDb } from '../../lib/supabase';
import type { ApiModule } from '../types';
import { expedientes } from './expedientes';
import { leaves } from './leaves';
import { portal } from './portal';
import { structure } from './structure';

/**
 * RH básico: estructura (áreas, puestos, jefes), expediente con documentos, alta guiada,
 * vacaciones, permisos e incapacidades, y portal del empleado. Incluido en todos los planes.
 */
const routes = new Hono<AppEnv>();
routes.use('*', requireAuth);
routes.route('/', structure);
routes.route('/', expedientes);
routes.route('/', leaves);
routes.route('/', portal);

export const rhModule: ApiModule = {
  key: 'rh',
  routes,

  /** Cuántas solicitudes esperan aprobación (para el aviso del panel). */
  async me({ env, auth, companyId }) {
    const access = auth.access.find((a) => a.companyId === companyId);
    if (!auth.isPlatformAdmin && !access?.permissions.has('rh.ausencias.aprobar')) return { pendingLeaves: 0 };
    const { count } = await rhDb(adminClient(env))
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('status', 'pendiente');
    return { pendingLeaves: count ?? 0 };
  },

  /** Expediente vacío del nuevo colaborador; la alta guiada lo completa. */
  async onEmployeeCreated(env, { employeeId, companyId }) {
    const { error } = await rhDb(adminClient(env)).from('employee_profiles').insert({ employee_id: employeeId, company_id: companyId });
    if (error) throw error;
  },
};
