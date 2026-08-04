/**
 * kernel/index.ts — public kernel surface. Pure libraries only: no CLI, no
 * host, no ambient filesystem or environment access outside paths.ts.
 */

export { resolvePaths } from './paths.ts';
export type { Paths, PathsEnv } from './paths.ts';
export { findUntaggedClaims } from './verify/claims.ts';
export type { UntaggedClaim } from './verify/claims.ts';
export { buildCleanupCatalog } from './cleanup/catalog.ts';
export type { CleanupItem, CleanupScope, CleanupRisk, CleanupTarget } from './cleanup/catalog.ts';
export { detectedItems, selectedItems, applyCleanup } from './cleanup/run.ts';
export type { CleanupOptions, CleanupOutcome, CleanupResult } from './cleanup/run.ts';

export { classifyIntake, formatTriageLine, suggestTags } from './intake/classify.ts';
export type {
  Candidate,
  ClassifyInput,
  RelatedDoc,
  TagSuggestion,
  TagVocabulary,
  TriageResult,
} from './intake/classify.ts';
export {
  DEFAULT_PRESET_ID,
  DEFAULT_TABLE,
  RECOMMENDED_ACTIONS,
  TABLES,
} from './intake/table.ts';
export type { ClassificationEntry, ClassificationTable, Triage } from './intake/table.ts';

export { matchingKeywords, suggestRoutes } from './routing/dispatcher.ts';
export type { Route, SuggestInput, SuggestResult, Suggestion } from './routing/dispatcher.ts';

export { DOMAINS, domainsByName } from './implication/domains.ts';
export type { Domain } from './implication/domains.ts';
export { MIN_SIGNAL, implicatedDomains, mapImplications } from './implication/map.ts';
export type { Implication, ImplicationMap, MapInput } from './implication/map.ts';

export { validateBrief } from './brief/schema.ts';
export type { Brief, BriefInput, BriefProblem, BriefValidation } from './brief/schema.ts';
export { UNSATISFIED_KINDS, explainUnsatisfied, satisfyBrief } from './brief/satisfy.ts';
export type {
  Availability,
  Binding,
  Resolution,
  Tool,
  Unsatisfied,
  UnsatisfiedKind,
} from './brief/satisfy.ts';

export {
  POSTCONDITIONS,
  describePostconditions,
  validateBinaryPostconditions,
} from './capabilities/postconditions.ts';
export type {
  PostconditionFailure,
  PostconditionResult,
  PostconditionRule,
} from './capabilities/postconditions.ts';

export { COMPLETION_STATES, completionRank, isCompletionState } from './completion/states.ts';
export type { CompletionState } from './completion/states.ts';
export {
  DEGRADATION_REASONS,
  highestState,
  makeEvidence,
  recordCompletion,
} from './completion/ledger.ts';
export type { DegradationReason, Evidence, EvidenceInput } from './completion/ledger.ts';

export {
  EXTRACTION_TIERS,
  makeUnsupportedResult,
  planExtraction,
  resolveExhaustion,
  resolveRoutingSignals,
} from './extract/ladder.ts';
export type {
  AcceptRule,
  Exhaustion,
  ExtractionPlan,
  ExtractionTier,
  PlanInput,
  PlanStep,
  PrivacyPosture,
  RoutingSignals,
  Unavailable,
  UnsupportedResult,
} from './extract/ladder.ts';
export {
  MIN_TEXT_DENSITY_CHARS_PER_PAGE,
  ROUTING_THRESHOLDS,
  docxRequiresDoclingEscalation,
  isDigitalTextPdf,
} from './extract/thresholds.ts';
export type {
  DocxStructureSignals,
  PdfTextYield,
  RoutingThresholds,
} from './extract/thresholds.ts';
export {
  MAX_RETAINED_CHARS,
  finalizeResult,
  validateExtractionResult,
} from './extract/envelope.ts';
export type {
  DropInfo,
  EnvelopeValidation,
  ExtractionResult,
  FinalizedResult,
} from './extract/envelope.ts';

export {
  AUTHORITY,
  FIELD_AUTHORITY,
  IDENTITY_FIELDS,
  authorityFor,
  isDomainOwned,
  isTrackerOwned,
  splitFieldsByAuthority,
} from './tracker/authority.ts';
export type { Authority, FieldsByAuthority } from './tracker/authority.ts';
export {
  PROJECTION_STATES,
  buildProjection,
  canonicalJson,
  projectionFieldsByAuthority,
  projectionId,
  valuesEqual,
} from './tracker/projection.ts';
export type {
  BuildProjectionOptions,
  Projection,
  ProjectionState,
} from './tracker/projection.ts';

export {
  applyReconciliation,
  planDependencyProjection,
  reconcileAll,
  reconcileProjection,
} from './tracker/reconcile.ts';
export type {
  AbsorbedField,
  ConflictField,
  DriftReport,
  ReconcileOptions,
  ReconcileResult,
} from './tracker/reconcile.ts';

// The storage substrate. Like cleanup/run.ts it does filesystem IO, but never
// ambiently: the path is injected, so the sterile test discipline still holds.
export { SCHEMA_VERSION, openStore, storePath, transact } from './store/open.ts';
export type { Store } from './store/open.ts';
export {
  countProjections,
  getProjection,
  listProjections,
  putProjection,
} from './store/projections.ts';
export { appendWorkLog, readWorkLog } from './store/worklog.ts';
export type { AppendWorkLog, WorkLogEntry } from './store/worklog.ts';
export {
  DECISION_STATES,
  getDecision,
  openDecisions,
  raiseDecision,
  resolveDecision,
} from './store/decisions.ts';
export type { Decision, DecisionState, Position, RaiseDecision } from './store/decisions.ts';
export { syncProjections } from './store/reconcile.ts';
export type { SyncOptions } from './store/reconcile.ts';
export {
  StaleLeaseError,
  TASK_STATES,
  claimTask,
  completeTask,
  countTasksByState,
  enqueueTask,
  failTask,
  getTask,
  listTasks,
  totalSpend,
} from './store/tasks.ts';
export type {
  ClaimTask,
  CompleteTask,
  EnqueueTask,
  FailTask,
  LeasedTask,
  SettleTask,
  Task,
  TaskState,
} from './store/tasks.ts';

export { startRun, taskId } from './run/outcome.ts';
export type { StartRunInput, StartedRun } from './run/outcome.ts';
export {
  DEFAULT_CONCURRENCY,
  DEFAULT_LEASE_MS,
  assignmentFor,
  spendOf,
  workRun,
} from './run/coordinator.ts';
export type { CoordinatorOptions, HaltReason, RunReport } from './run/coordinator.ts';
export {
  CONCERN_KINDS,
  deliverableConcerns,
  licensedReviewFor,
} from './run/accountability.ts';
export type { Concern, ConcernKind } from './run/accountability.ts';
export {
  STANCES,
  STANCE_PROTOCOL,
  frameConflict,
  isConflict,
  parseStance,
} from './run/conflicts.ts';
export type { DeclaredStance, FrameInput, RoleStance, Stance } from './run/conflicts.ts';

export { CAPABILITIES, hasCapability, validate as validateHost } from './hosts/interface.ts';
export type {
  HostAdapter,
  HostCancellation,
  HostCapability,
  HostContext,
  HostHealth,
  HostResult,
  HostStatus,
  HostValidation,
} from './hosts/interface.ts';
export {
  HostError,
  HostNotReadyError,
  InvocationError,
  InvocationTimeoutError,
} from './hosts/errors.ts';
export type { HostErrorOptions } from './hosts/errors.ts';
