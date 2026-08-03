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

export { suggestRoutes } from './routing/dispatcher.ts';
export type { Route, SuggestInput, SuggestResult, Suggestion } from './routing/dispatcher.ts';

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
