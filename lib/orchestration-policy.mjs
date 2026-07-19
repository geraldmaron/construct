/**
 * lib/orchestration-policy.mjs — provider-agnostic routing and escalation policy.
 *
 * Routing surfaces three things every call:
 *   1. execution track + specialist list  (who runs, in what order)
 *   2. framing/research/doc-ownership gates  (what must be true before work starts)
 *   3. contract chain (resolveContractChain)  (what the typed handoffs are)
 *
 * Agent-to-agent contracts are declared in specialists/org
 * (capability contracts) and resolved via lib/capability-contracts.mjs. The
 * unified registry is the source of truth for producer→consumer typed handoffs.
 *
 * Event ownership, doc-artifact ownership, and watch-condition routing live
 * declaratively on specialist entries in specialists/org and are
 * resolved by lib/orchestration/routing-tables.mjs. Hardcoded maps here
 * would create a second source of truth.
 *
 * Thin re-export layer (construct-rf26.10): the actual
 * implementation is split by concern into lib/orchestration/:
 *   - policy-constants.mjs  — EXECUTION_TRACKS/INTENT_CLASSES/etc enums
 *   - classification.mjs    — intent/work-category/risk-flag/flavor classifiers
 *   - gates.mjs              — research/framing/approval gates, team routing
 *   - flow-selection.mjs     — specialist selection + routeRequest and friends
 * Kept as a single re-export surface (rather than updating every import site
 * to the new paths) because lib/orchestration-policy.mjs is imported by ~25
 * other modules and test files; splitting the export surface without
 * splitting every caller would multiply the blast radius of this refactor
 * for no behavioral benefit. See construct-rf26.10 for the tradeoff.
 */
export {
  EXECUTION_TRACKS,
  INTENT_CLASSES,
  WORK_CATEGORIES,
  TERMINAL_STATES,
} from './orchestration/policy-constants.mjs';

export { ownerForEvent, ownerForDoc } from './orchestration/routing-tables.mjs';

export {
  resolveDocTypeMention,
  detectDocAuthoringIntent,
  extractNamedEntities,
  classifyResearchShape,
  requiresLiveWebAccess,
  isProductIntelligenceRequest,
  classifyProductManagerFlavor,
  classifyArchitectFlavor,
  classifyQaFlavor,
  classifySecurityFlavor,
  classifyDataAnalystFlavor,
  classifyDataEngineerFlavor,
  classifyEngineerFlavor,
  isDataAnalysisRequest,
  isDataEngineeringRequest,
  isLegalComplianceRequest,
  isBusinessStrategyRequest,
  isOperationsPlanningRequest,
  isRdLeadRequest,
  isExplorerRequest,
  isVisualDeliverableRequest,
  classifyRoleFlavors,
  formatOverlaySelection,
  detectRiskFlags,
  classifyIntent,
  classifyWorkCategory,
  determineExecutionTrack,
} from './orchestration/classification.mjs';

export {
  requiresExternalResearch,
  requiresFramingChallenge,
  requiresExecutiveApproval,
  policyRoutingForWorkerProfiles,
} from './orchestration/gates.mjs';

export {
  selectWorkerProfiles,
  augmentWorkerProfiles,
  identifyParallelChecks,
  requestSignals,
  proactiveTriggers,
  formatOverlayTrace,
  routeRequest,
  routeRequestVerified,
  buildConstructToOrchestratorPacket,
} from './orchestration/flow-selection.mjs';
