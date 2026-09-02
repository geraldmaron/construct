/**
 * kernel/services/run.ts — start/get run with concerns.
 */

import type { StateStore } from '../state-v1/open.ts';
import {
  startRun,
  getRun,
  listRunConcerns,
  type Run,
  type RunConcern,
} from '../state-v1/runs.ts';
import { enqueueTask } from '../state-v1/tasks.ts';

export interface RunService {
  start(input: {
    readonly id: string;
    readonly outcome: string;
    readonly at: string;
    readonly concerns?: readonly RunConcern[];
    readonly tasks?: readonly {
      readonly id: string;
      readonly role: string;
      readonly brief: unknown;
    }[];
  }): Run;
  get(id: string): (Run & { readonly concerns: readonly RunConcern[] }) | null;
}

export function createRunService(store: StateStore): RunService {
  return {
    start(input) {
      const run = startRun(store, input);
      for (const task of input.tasks ?? []) {
        enqueueTask(store, {
          id: task.id,
          runId: run.id,
          role: task.role,
          brief: task.brief,
          at: input.at,
        });
      }
      return run;
    },
    get(id) {
      const run = getRun(store, id);
      if (!run) return null;
      return { ...run, concerns: listRunConcerns(store, id) };
    },
  };
}
