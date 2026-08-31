/**
 * kernel/services/task.ts — claim / submit / fail over format-v1 tasks.
 */

import type { StateStore } from '../state/open.ts';
import { claimTask, getTask, type LeasedTask, type Task } from '../state/tasks.ts';
import {
  submitCompletedWork,
  submitFailedWork,
  type SubmitCompletedWorkResult,
} from '../state/submit.ts';
import { getDeliverableByTask, type Deliverable } from '../state/deliverables.ts';

export interface TaskService {
  claim(input: {
    readonly owner: string;
    readonly leaseUntil: string;
    readonly now: string;
    readonly runId?: string;
  }): LeasedTask | null;
  submit(input: {
    readonly leased: LeasedTask;
    readonly at: string;
    readonly deliverable?: unknown;
    readonly note?: string;
    readonly settleNoteAsDone?: boolean;
  }): SubmitCompletedWorkResult;
  fail(input: {
    readonly leased: LeasedTask;
    readonly at: string;
    readonly error: unknown;
  }): Task;
  get(id: string): Task | null;
  deliverableFor(taskId: string): Deliverable | null;
}

export function createTaskService(store: StateStore): TaskService {
  return {
    claim: (input) => claimTask(store, input),
    submit: (input) => submitCompletedWork(store, input),
    fail: (input) => submitFailedWork(store, input),
    get: (id) => getTask(store, id),
    deliverableFor: (taskId) => getDeliverableByTask(store, taskId),
  };
}
