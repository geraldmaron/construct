/**
 * kernel/services/routine.ts — Routine façade + one-shot headless run.
 *
 * standing/watch/schedule/daemon product concepts collapse here. Trigger
 * plumbing for scheduled/event remains; deletion of those CLI verbs is Phase G.
 */

import { randomUUID } from 'node:crypto';
import type { StateStore } from '../state-v1/open.ts';
import {
  createRoutine,
  getRoutine,
  listRoutines,
  markRoutineRun,
  setRoutineEnabled,
  type Routine,
} from '../state-v1/routines.ts';
import { createHeadlessRunService } from './headless-run.ts';
import type { Run } from '../state-v1/runs.ts';

function pinFromPolicy(policy: unknown): string | null {
  if (policy === null || typeof policy !== 'object') return null;
  const pin = (policy as { pin?: unknown }).pin;
  return typeof pin === 'string' && pin.trim() !== '' ? pin.trim() : null;
}

export interface RoutineRunResult {
  readonly routine: Routine;
  readonly run: Run;
  readonly executorPin: string;
}

export interface RoutineService {
  create(input: Parameters<typeof createRoutine>[1]): Routine;
  get(id: string): Routine | null;
  list(): Routine[];
  enable(id: string, at: string): Routine;
  disable(id: string, at: string): Routine;
  /**
   * Start one headless run from the routine's expected output and pinned
   * executor. Refuses when disabled or when executionPolicy has no pin.
   */
  runOnce(id: string, at: string): RoutineRunResult;
}

export function createRoutineService(store: StateStore): RoutineService {
  return {
    create: (input) => createRoutine(store, input),
    get: (id) => getRoutine(store, id),
    list: () => listRoutines(store),
    enable: (id, at) => setRoutineEnabled(store, { id, enabled: true, at }),
    disable: (id, at) => setRoutineEnabled(store, { id, enabled: false, at }),
    runOnce(id, at) {
      const routine = getRoutine(store, id);
      if (!routine) throw new Error(`routine ${id} not found`);
      if (!routine.enabled) throw new Error(`routine ${id} is disabled`);
      const pin = pinFromPolicy(routine.executionPolicy);
      if (!pin) {
        throw new Error(
          `routine ${id} has no executor pin — set executionPolicy.pin before running headless`,
        );
      }
      const headless = createHeadlessRunService(store, {
        executorPin: pin,
        owner: `routine:${id}`,
        allowResourceSelection: false,
      });
      const runId = `run-routine-${id}-${randomUUID().slice(0, 8)}`;
      const workflow = routine.workflow;
      const role =
        workflow !== null &&
        typeof workflow === 'object' &&
        typeof (workflow as { skill?: unknown }).skill === 'string'
          ? String((workflow as { skill: string }).skill)
          : 'routine';
      const run = headless.startRun({
        id: runId,
        outcome: routine.expectedOutput,
        at,
        tasks: [
          {
            id: `task-${runId}-1`,
            role,
            brief: {
              routineId: id,
              expectedOutput: routine.expectedOutput,
              workflow: routine.workflow,
              inputSourceIds: routine.inputSourceIds,
            },
          },
        ],
      });
      const updated = markRoutineRun(store, { id, at });
      return { routine: updated, run, executorPin: pin };
    },
  };
}
