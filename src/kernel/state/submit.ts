/**
 * kernel/state/submit.ts — submit completed interactive/headless work.
 *
 * Settles the task (execution) and upserts a draft (trust). Those are
 * separate: success here never promotes the deliverable.
 */

import type { StateStore } from './open.ts';
import { appendActivity, upsertDraft, getDeliverableByTask } from './deliverables.ts';
import type { Deliverable } from './deliverables.ts';
import {
  completeTask,
  failTask,
  getTask,
  StaleLeaseError,
  type LeasedTask,
} from './tasks.ts';
import type { Task } from './tasks.ts';

export interface SubmitCompletedWorkInput {
  readonly leased: LeasedTask;
  readonly at: string;
  /** Finished work body. Omit for note-only updates (task stays leased unless settleNoteAsDone). */
  readonly deliverable?: unknown;
  readonly note?: string;
  /** When true and only a note is provided, still mark the task done. Default false. */
  readonly settleNoteAsDone?: boolean;
  readonly deliverableId?: string;
}

export interface SubmitCompletedWorkResult {
  readonly task: Task;
  readonly deliverable: Deliverable | null;
  readonly noteOnly: boolean;
}

/**
 * Submit finished work under a live lease.
 *
 * - With a deliverable: task → done, deliverable → draft.
 * - Note-only: activity recorded; task stays leased unless settleNoteAsDone.
 */
export function submitCompletedWork(
  store: StateStore,
  input: SubmitCompletedWorkInput,
): SubmitCompletedWorkResult {
  const { leased } = input;
  const hasDeliverable = 'deliverable' in input && input.deliverable !== undefined;
  const hasNote = typeof input.note === 'string' && input.note.trim() !== '';

  if (!hasDeliverable && !hasNote) {
    throw new Error('submit requires a deliverable or a non-empty note');
  }

  // Fence check before side effects: stale token must not create drafts.
  const current = getTask(store, leased.id);
  if (
    current === null ||
    current.state !== 'leased' ||
    current.leaseOwner !== leased.leaseOwner ||
    current.attempts !== leased.token
  ) {
    throw new StaleLeaseError(leased.id, leased.token);
  }

  let deliverable: Deliverable | null = null;
  let noteOnly = false;

  if (hasDeliverable) {
    completeTask(store, {
      id: leased.id,
      owner: leased.leaseOwner,
      token: leased.token,
      at: input.at,
      result: { submitted: true },
    });
    deliverable = upsertDraft(store, {
      id: input.deliverableId ?? `deliv:${leased.id}`,
      taskId: leased.id,
      runId: leased.runId,
      body: input.deliverable,
      at: input.at,
    });
    appendActivity(store, {
      at: input.at,
      kind: 'task.completed',
      runId: leased.runId,
      taskId: leased.id,
      payload: { trustState: deliverable.trustState },
    });
    appendActivity(store, {
      at: input.at,
      kind: 'deliverable.drafted',
      runId: leased.runId,
      taskId: leased.id,
      payload: { deliverableId: deliverable.id },
    });
  } else {
    noteOnly = true;
    appendActivity(store, {
      at: input.at,
      kind: 'task.note',
      runId: leased.runId,
      taskId: leased.id,
      payload: { note: input.note },
    });
    if (input.settleNoteAsDone) {
      completeTask(store, {
        id: leased.id,
        owner: leased.leaseOwner,
        token: leased.token,
        at: input.at,
        result: { noteOnly: true },
      });
    }
  }

  const task = getTask(store, leased.id);
  if (!task) throw new Error('task missing after submit');
  return {
    task,
    deliverable: deliverable ?? getDeliverableByTask(store, leased.id),
    noteOnly,
  };
}

export function submitFailedWork(
  store: StateStore,
  input: { readonly leased: LeasedTask; readonly at: string; readonly error: unknown },
): Task {
  failTask(store, {
    id: input.leased.id,
    owner: input.leased.leaseOwner,
    token: input.leased.token,
    at: input.at,
    error: input.error,
  });
  appendActivity(store, {
    at: input.at,
    kind: 'task.failed',
    runId: input.leased.runId,
    taskId: input.leased.id,
    payload: { error: input.error },
  });
  const task = getTask(store, input.leased.id);
  if (!task) throw new Error('task missing after fail');
  return task;
}

export { StaleLeaseError };
