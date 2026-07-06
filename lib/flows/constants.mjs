/**
 * lib/flows/constants.mjs — shared sentinels and status enums for the flow engine.
 *
 * TERMINAL is a plain string sentinel (not a Symbol) so a router's return value
 * survives JSON serialization unchanged, matching the future checkpoint/resume
 * requirement that a run's next-step pointer be persistable as-is.
 */

export const TERMINAL = '@@flow/terminal';

export const WORKER_BACKENDS = Object.freeze(['inline', 'provider', 'host']);

export const STEP_STATUS = Object.freeze({
  DONE: 'done',
  ERROR: 'error',
  BUDGET_EXHAUSTED: 'budget-exhausted',
  INVALID_STATE: 'invalid-state',
});

export const RUN_STATUS = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  ERROR: 'error',
  BUDGET_EXHAUSTED: 'budget-exhausted',
});

export const JOIN_MODES = Object.freeze(['all', 'any']);
