/**
 * kernel/work/service.ts — the native bounded work ledger.
 *
 * Work items, blocking and informational dependencies, atomic claims with
 * fencing tokens, and versioned export/restore live here. Workflow runs stay
 * in kernel/state/runs.ts; a work item may have many runs without duplicating
 * its business meaning. Readiness is computed from admission, blocking
 * dependencies, live claims, and premises a source refresh marked stale —
 * not from a status string alone. Parents, reasons, and admission live in
 * structure.ts.
 */

export {
  WORK_KINDS,
  type WorkKind,
  WORK_STATUSES,
  type WorkStatus,
  WORK_DEP_KINDS,
  type WorkDepKind,
  DELEGATION_ATTEMPT_EVENT,
  type WorkItem,
  isRunDelivery,
  recordEvent,
  getWork,
  getWorkByLegacyId,
  childrenOf,
  acceptanceOf,
  type WorkQuery,
  type WorkPage,
  queryWork,
  type WorkDep,
  listWorkDependencies,
  type Readiness,
  readinessOf,
  listReady,
  type ClaimedWork,
  type Reservation,
  type Claimant,
} from './helpers.ts';
export {
  type CreateWorkInput,
  createWork,
  bindLegacyId,
  addWorkDependency,
  removeWorkDependency,
  requalifyWork,
  markPremisesStale,
  updateWork,
} from './create-update.ts';
export { endRunDelivery, completeWork, cancelWork, reopenWork, supersedeWork, associateRun } from './completion.ts';
export { CLAIM_QUIET_CAP_MS, claimWork, takeoverWork, renewSessionClaims, releaseWork } from './claims.ts';
export { HANDOFF_HOLD_MS, handoffOf, handoffWork, prepareAcceptance, acceptWork, listOffers } from './handoff-lifecycle.ts';
export { type WorkExport, exportWork, type RestoreReport, restoreWork } from './export-restore.ts';
