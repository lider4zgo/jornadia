import type { ApiModule } from './types';
import { jornadaModule } from './jornada';
import { rhModule } from './rh';

/**
 * Módulos disponibles en la API. Para agregar uno (nómina, finanzas…):
 * crea apps/api/src/modules/<key>/index.ts que exporte un ApiModule y agrégalo aquí.
 */
export const MODULE_REGISTRY: ApiModule[] = [jornadaModule, rhModule];
