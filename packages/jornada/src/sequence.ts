import type { PunchKind } from './types';

/** Qué checadas puede hacer el trabajador según la última que registró. */
export function allowedNextKinds(last: PunchKind | null | undefined): PunchKind[] {
  switch (last) {
    case 'in':
      return ['break_start', 'out'];
    case 'break_start':
      return ['break_end'];
    case 'break_end':
      return ['break_start', 'out'];
    case 'out':
    case null:
    case undefined:
    default:
      return ['in'];
  }
}

export function isValidTransition(last: PunchKind | null | undefined, next: PunchKind): boolean {
  return allowedNextKinds(last).includes(next);
}

export function transitionError(last: PunchKind | null | undefined, next: PunchKind): string | null {
  if (isValidTransition(last, next)) return null;
  if (next === 'in') return 'Ya tienes una entrada abierta; registra tu salida primero.';
  if (next === 'out' && last === 'break_start') return 'Estás en comida; registra el fin de comida antes de salir.';
  if (next === 'break_end') return 'No has iniciado tu comida.';
  return 'Primero registra tu entrada.';
}
