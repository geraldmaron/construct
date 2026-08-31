/**
 * kernel/services/routine.ts — routine façade.
 */

import type { StateStore } from '../state/open.ts';
import {
  createRoutine,
  getRoutine,
  listRoutines,
  type Routine,
} from '../state/routines.ts';

export interface RoutineService {
  create(input: Parameters<typeof createRoutine>[1]): Routine;
  get(id: string): Routine | null;
  list(): Routine[];
}

export function createRoutineService(store: StateStore): RoutineService {
  return {
    create: (input) => createRoutine(store, input),
    get: (id) => getRoutine(store, id),
    list: () => listRoutines(store),
  };
}
