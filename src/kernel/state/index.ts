/**
 * kernel/state/index.ts — format v1 project state surface.
 */

export {
  STATE_FORMAT_ID,
  STATE_FORMAT_VERSION,
  UNSUPPORTED_ALPHA_MESSAGE,
  UnsupportedAlphaStoreError,
} from './format.ts';
export { openStateStore, type StateStore } from './open.ts';
export {
  TASK_STATES,
  StaleLeaseError,
  ensureRun,
  enqueueTask,
  claimTask,
  completeTask,
  failTask,
  getTask,
  operatorRevokeTask,
  listTasks,
  countTasksByState,
  type Task,
  type TaskState,
  type LeasedTask,
} from './tasks.ts';
export {
  TRUST_STATES,
  upsertDraft,
  getDeliverableByTask,
  setTrustState,
  appendActivity,
  listActivity,
  type Deliverable,
  type TrustState,
  type ActivityEvent,
} from './deliverables.ts';
export {
  submitCompletedWork,
  submitFailedWork,
  type SubmitCompletedWorkInput,
  type SubmitCompletedWorkResult,
} from './submit.ts';
export {
  startRun,
  getRun,
  listRunConcerns,
  type Run,
  type RunConcern,
} from './runs.ts';
export {
  createStaffMember,
  getStaffMember,
  listStaffMembers,
  setStaffStatus,
  type StaffMember,
  type StaffStatus,
} from './staff.ts';
export { addSource, getSource, listSources, type Source } from './sources.ts';
export {
  createRoutine,
  getRoutine,
  listRoutines,
  setRoutineEnabled,
  markRoutineRun,
  type Routine,
  type RoutineTriggerKind,
} from './routines.ts';
export {
  raiseDecision,
  resolveDecision,
  listOpenDecisions,
  getDecision,
  applyDecisionEffect,
  DECISION_KINDS,
  type Decision,
  type DecisionKind,
  type DecisionSubject,
} from './decisions.ts';
export {
  upsertIntegration,
  getIntegration,
  listIntegrations,
  type IntegrationState,
  type IntegrationStatus,
} from './integrations.ts';
