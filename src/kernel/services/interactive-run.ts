/**
 * kernel/services/interactive-run.ts — interactive session execution path.
 *
 * Host session → MCP → this service → claim / execute-here / submit.
 *
 * Structurally forbidden: ambient host routing and headless executor picking.
 * The active session is the executor unless an explicit override is recorded
 * on the call (not inferred from installed agents).
 */

import type { StateStore } from '../state-v1/open.ts';
import { createRunService, type RunService } from './run.ts';
import { createTaskService, type TaskService } from './task.ts';
import type { LeasedTask } from '../state-v1/tasks.ts';
import type { SubmitCompletedWorkResult } from '../state-v1/submit.ts';
import type { Run, RunConcern } from '../state-v1/runs.ts';
import { appendActivity } from '../state-v1/deliverables.ts';

export interface InteractiveSession {
  /** Client where the user is interacting (cursor, claude-code, …). */
  readonly client: string;
  /** Agent host backing the session if known; unknown still means interactive. */
  readonly host: string;
  /** Stable owner id for leases (e.g. session:cursor). */
  readonly owner: string;
  /**
   * Explicit per-request executor override. Absent → this session executes.
   * Never inferred from installed/authenticated agents.
   */
  readonly executorOverride?: string;
  readonly overrideSource?: 'explicit-user-request' | 'run-pin' | 'project-policy';
}

export interface InteractiveRunService {
  readonly session: InteractiveSession;
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
    readonly settleNoteAsDone?: boolean;
  }): SubmitCompletedWorkResult;
  /** Effective executor for this turn — session unless explicit override. */
  effectiveExecutor(): { readonly executor: string; readonly source: string };
}

/**
 * Build the interactive path. Do not import host census or selection modules
 * into this file — enforced by tests/architecture/interactive-isolation.test.ts.
 */
export function createInteractiveRunService(
  store: StateStore,
  session: InteractiveSession,
): InteractiveRunService {
  const runs: RunService = createRunService(store);
  const tasks: TaskService = createTaskService(store);

  return {
    session,
    startRun(input) {
      const run = runs.start(input);
      appendActivity(store, {
        at: input.at,
        kind: 'execution.bound',
        runId: run.id,
        payload: {
          client: session.client,
          host: session.host,
          executor: session.executorOverride ?? session.client,
          overrideSource: session.overrideSource ?? null,
          mode: 'interactive',
        },
      });
      return run;
    },
    nextWork(input) {
      return tasks.claim({
        owner: session.owner,
        leaseUntil: input.leaseUntil,
        now: input.now,
        runId: input.runId,
      });
    },
    submitWork(input) {
      return tasks.submit(input);
    },
    effectiveExecutor() {
      if (session.executorOverride) {
        return {
          executor: session.executorOverride,
          source: session.overrideSource ?? 'explicit-user-request',
        };
      }
      return { executor: session.client, source: 'active-interactive-session' };
    },
  };
}
