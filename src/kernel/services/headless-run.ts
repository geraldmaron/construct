/**
 * kernel/services/headless-run.ts — explicit headless execution path.
 *
 * Only reachable when the caller opts into headless policy. This is where
 * capability/cost/availability selection may happen — never from the
 * interactive service.
 */

import type { StateStore } from '../state/open.ts';
import { createRunService, type RunService } from './run.ts';
import { createTaskService, type TaskService } from './task.ts';
import type { LeasedTask } from '../state/tasks.ts';
import type { SubmitCompletedWorkResult } from '../state/submit.ts';
import type { Run, RunConcern } from '../state/runs.ts';
import { appendActivity } from '../state/deliverables.ts';

export interface HeadlessExecutionPolicy {
  /** Required. Headless has no ambient session. */
  readonly executorPin: string;
  readonly owner: string;
  readonly allowResourceSelection?: boolean;
  readonly selectionReason?: string;
}

export interface HeadlessRunService {
  readonly policy: HeadlessExecutionPolicy;
  startRun(input: {
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
  nextWork(input: { readonly now: string; readonly leaseUntil: string; readonly runId?: string }): LeasedTask | null;
  submitWork(input: {
    readonly leased: LeasedTask;
    readonly at: string;
    readonly deliverable?: unknown;
    readonly note?: string;
  }): SubmitCompletedWorkResult;
  /**
   * Optional hook for resource selection. InteractiveRunService has no
   * equivalent. The selector function is injected so this module need not
   * import the census graph at load time when unused.
   */
  selectExecutorIfAllowed<T>(select: () => T): T;
}

export function createHeadlessRunService(
  store: StateStore,
  policy: HeadlessExecutionPolicy,
): HeadlessRunService {
  if (!policy.executorPin.trim()) {
    throw new Error('headless execution requires an explicit executor pin');
  }
  const runs: RunService = createRunService(store);
  const tasks: TaskService = createTaskService(store);

  return {
    policy,
    startRun(input) {
      const run = runs.start(input);
      appendActivity(store, {
        at: input.at,
        kind: 'execution.bound',
        runId: run.id,
        payload: {
          mode: 'headless',
          executor: policy.executorPin,
          allowResourceSelection: policy.allowResourceSelection === true,
        },
      });
      return run;
    },
    nextWork(input) {
      return tasks.claim({
        owner: policy.owner,
        leaseUntil: input.leaseUntil,
        now: input.now,
        runId: input.runId,
      });
    },
    submitWork(input) {
      return tasks.submit(input);
    },
    selectExecutorIfAllowed(select) {
      if (policy.allowResourceSelection !== true) {
        throw new Error(
          'resource selection is disabled for this headless policy; pin an executor',
        );
      }
      return select();
    },
  };
}
