/**
 * lib/orchestration/flow-selection.mjs — Worker Profile/Procedure selection for
 * orchestration routing policy: which assignments run, in what order,
 * parallel checks, proactive triggers, and the top-level routeRequest/
 * routeRequestVerified/buildConstructToOrchestratorPacket entry points.
 * 
 * Extracted from lib/orchestration-policy.mjs. This is
 * the module that composes classification.mjs (what kind of request) and
 * gates.mjs (what must be true first) into a concrete dispatch plan.
 * orchestration-policy.mjs re-exports these unchanged for existing callers.
 */
import { resolveContractChain } from '../capability-contracts.mjs';
import { verifyRoute } from '../intent-classifier.mjs';
import { evaluateWatchConditions } from './routing-tables.mjs';
import { resolveArtifactWorkflowContract } from '../artifact-manifest.mjs';
import { buildResearchExecutionPolicy } from '../research-execution-policy.mjs';
import { EXECUTION_TRACKS, INTENT_CLASSES, WORK_CATEGORIES } from './policy-constants.mjs';
import {
  classifyEngineerFlavor, isExplorerRequest, isProductIntelligenceRequest,
  isDataAnalysisRequest, isDataEngineeringRequest, detectDocAuthoringIntent,
  detectDocAuthoringItems,
  isLegalComplianceRequest, isBusinessStrategyRequest, isOperationsPlanningRequest,
  isRdLeadRequest, containsAny, detectRiskFlags, classifyWorkCategory,
  classifyIntent, classifyRoleFlavors, classifyProductManagerFlavor,
  isVisualDeliverableRequest, determineExecutionTrack, detectExplicitWorkerProfile,
  detectTeamChain,
} from './classification.mjs';
import { focusedRoutingChain, applyRoutingTriggerAugmentation } from './routing-triggers.mjs';
import { buildAdvisoryAssignments } from './recruiter.mjs';
import {
  requiresExternalResearch, requiresFramingChallenge,
  resolveArtifactReviewRequirements, policyRoutingForWorkerProfiles,
} from './gates.mjs';
import { loadSignalDimensions } from './signal-dimensions.mjs';

const WORKER_PROFILE_MAP = {
  implementation: ['engineer'],
  investigation: ['debugger', 'engineer'],
  evaluation: ['reviewer'],
  fix: ['debugger', 'engineer'],
  research: ['researcher'],
};

const WORKFLOW_SKILL_TO_TYPE = {
  'docs/prd-workflow': 'prd-draft',
  'docs/adr-workflow': 'architecture-review',
  'docs/research-workflow': 'research-synthesis',
  'docs/evidence-ingest-workflow': 'evidence-ingest',
};

// AI/platform/data engineering are skill bundles on the single engineer
// specialist, not separate dispatch targets, so specialist selection never
// substitutes a flavor-specific id here. The engineer flavor is still
// detected via classifyEngineerFlavor()/classifyRoleFlavors() and drives
// which skills/perspectives/*.md overlay loads onto engineer — see
// lib/roles/flavor-bindings.mjs for that binding.
function refineEngineeringWorkerProfiles(workerProfiles) {
  return workerProfiles;
}

const OPERATIONS_EMBED_SIGNALS = [
  'runbook', 'on-call', 'oncall', 'on call', 'incident response plan',
  'playbook', 'escalation path',
];

function suggestWorkflowType({ intent, request = '', docAuthoring } = {}) {
  const text = String(request).toLowerCase();
  const localWalkthrough = isExplorerRequest(request)
    || /\b(?:explain|understand|what does|what is)\b[\s\S]{0,60}\b(?:how\b|do\b|does\b|works?\b|flow\b|path\b|layer\b|module\b|implementation\b|code\b|function\b)/i.test(text)
    || /\bhow\b[\s\S]{0,40}\bworks?\b/i.test(text);
  if (intent === INTENT_CLASSES.research && !localWalkthrough) {
    return 'research-synthesis';
  }
  if (docAuthoring?.docType) {
    const contract = resolveArtifactWorkflowContract(docAuthoring.docType);
    const workflowType = WORKFLOW_SKILL_TO_TYPE[contract?.workflowSkill];
    if (workflowType) return workflowType;
  }
  return null;
}

export function selectWorkerProfiles({ request = '', intent, track, riskFlags = detectRiskFlags(request), workCategory = classifyWorkCategory(request, riskFlags) } = {}) {
  const text = String(request).toLowerCase();
  const productRequest = isProductIntelligenceRequest(text);
  const dataAnalysisRequest = isDataAnalysisRequest(text);
  const dataEngineeringRequest = isDataEngineeringRequest(text);
  if (track === EXECUTION_TRACKS.immediate) {
    if (intent === INTENT_CLASSES.implementation) {
      return refineEngineeringWorkerProfiles(['engineer'], request);
    }
    return [];
  }
  if (track === EXECUTION_TRACKS.focused) {
    if (workCategory === WORK_CATEGORIES.visual || riskFlags.ui) return ['designer'];
    if (productRequest) return ['product-manager'];
    const docAuthoring = detectDocAuthoringIntent(text);
    if (docAuthoring?.owner) return [docAuthoring.owner];
    if (dataEngineeringRequest) return ['engineer'];
    if (dataAnalysisRequest) return ['data-analyst'];
    const routingChain = focusedRoutingChain(text, { riskFlags, docType: docAuthoring?.docType ?? null });
    if (routingChain) return routingChain;
    if (isBusinessStrategyRequest(text)) return ['product-manager'];
    if (isOperationsPlanningRequest(text)) return ['operations'];
    if (isRdLeadRequest(text)) return ['architect'];
    if (isExplorerRequest(text)) return ['researcher'];
    if (riskFlags.docs) return ['operations'];
    if (riskFlags.security && intent === INTENT_CLASSES.evaluation) return refineEngineeringWorkerProfiles(['security'], request);
    return refineEngineeringWorkerProfiles(WORKER_PROFILE_MAP[intent] || ['engineer'], request);
  }

  const workerProfiles = ['architect'];
  if (intent === INTENT_CLASSES.fix || intent === INTENT_CLASSES.investigation) workerProfiles.push('debugger');
  if (intent === INTENT_CLASSES.research) workerProfiles.push('researcher');
  const docAuthoring = detectDocAuthoringIntent(text);
  if (docAuthoring?.owner) workerProfiles.push(docAuthoring.owner);
  if (workCategory === WORK_CATEGORIES.visual || riskFlags.ui) workerProfiles.push('designer');
  if (productRequest) workerProfiles.push('product-manager');
  if (dataAnalysisRequest) workerProfiles.push('data-analyst');
  if (dataEngineeringRequest) workerProfiles.push('engineer');
  else if (riskFlags.docs || isOperationsPlanningRequest(text)) workerProfiles.push('operations');
  workerProfiles.push('engineer', 'reviewer', 'qa');
  if (riskFlags.security || riskFlags.dataIntegrity) workerProfiles.push('security');
  return refineEngineeringWorkerProfiles(Array.from(new Set(workerProfiles)), request);
}

export function augmentWorkerProfiles(
  workerProfiles = [],
  {
    request = '',
    docAuthoring = null,
    externalResearch = null,
    framingChallenge = null,
    artifactReview = null,
    triggers = [],
  } = {},
) {
  let list = [...workerProfiles];
  const teamChain = detectTeamChain(request);
  const explicit = detectExplicitWorkerProfile(request);

  if (teamChain.length >= 2) {
    return teamChain;
  }

  if (docAuthoring?.owner && !list.includes(docAuthoring.owner)) {
    list = [docAuthoring.owner, ...list];
  }

  if (externalResearch?.required && !list.includes('researcher')) {
    const namedLead = explicit && explicit !== 'researcher';
    const researchIsLead =
      externalResearch.reason === 'web-access'
      || externalResearch.reason === 'research-shaped'
      || !namedLead;
    if (researchIsLead) {
      list = ['researcher', ...list];
    } else {
      list = [...list, 'researcher'];
    }
  }

  if (framingChallenge?.required && !list.includes('reviewer')) {
    list = ['reviewer', ...list];
  }
  for (const reviewer of artifactReview?.requiredReviewers || []) {
    if (!list.includes(reviewer)) list = [...list, reviewer];
  }
  list = applyRoutingTriggerAugmentation(list, request, { docType: docAuthoring?.docType ?? null });
  if (isRdLeadRequest(request) && !list.includes('architect')) {
    list = ['architect', ...list];
  }
  if (isBusinessStrategyRequest(request) && !list.includes('product-manager')) {
    list = ['product-manager', ...list];
  }
  if (
    (isOperationsPlanningRequest(request) || containsAny(String(request).toLowerCase(), OPERATIONS_EMBED_SIGNALS))
    && !list.includes('operations')
  ) {
    list = ['operations', ...list];
  }
  for (const { workerProfile } of triggers) {
    if (!list.includes(workerProfile)) list = [workerProfile, ...list];
  }

  if (explicit && teamChain.length < 2) {
    list = [explicit, ...list.filter((id) => id !== explicit)];
  }

  return Array.from(new Set(list));
}

function enrichPolicyForProjectQuestion(request, policyWorkerProfiles = []) {
  if (!/\b(what is this (project|repo|codebase)|what('s| is) this (project|repo|codebase)|describe this (project|repo|codebase))\b/i.test(String(request))) {
    return policyWorkerProfiles;
  }
  const list = [...policyWorkerProfiles];
  if (!list.includes('researcher')) list.unshift('researcher');
  return Array.from(new Set(list));
}

/**
 * Identify specialists that can run in parallel with implementation.
 * Returns an array of specialist names that should execute concurrently
 * rather than sequentially. This reduces latency for independent checks.
 * 
 * Parallel execution is safe when:
 * - The specialist only reads/analyzes (doesn't mutate)
 * - Their output doesn't depend on implementation completing first
 * - They provide early feedback that can shape implementation
 */
export function identifyParallelChecks({ request = '', riskFlags = detectRiskFlags(request), workCategory = classifyWorkCategory(request, riskFlags) } = {}) {
  const parallelChecks = [];
  const text = String(request).toLowerCase();
  
  // Security review can run parallel to implementation for early threat detection
  if (riskFlags.security || containsAny(text, ['auth', 'permission', 'secret', 'payment', 'pii'])) {
    parallelChecks.push('security');
  }
  
  // Accessibility review can run parallel for UI work
  if (workCategory === WORK_CATEGORIES.visual || riskFlags.ui || containsAny(text, ['ui', 'ux', 'interface', 'component'])) {
    parallelChecks.push('designer');
  }

  // Performance review for data-intensive operations
  if (containsAny(text, ['performance', 'latency', 'throughput', 'scale', 'optimization'])) {
    parallelChecks.push('operations');
  }

  // Legal compliance for regulated domains — same specialist as the security
  // check above (legal-compliance folded into security), so dedupe.
  if (isLegalComplianceRequest(request) && !parallelChecks.includes('security')) {
    parallelChecks.push('security');
  }


  return parallelChecks;
}

// Structured request signals computed once and fed to both selectSpecialists
// and the proactive-trigger pass. Centralises every cheap signal so specialists
// don't each re-derive them from raw text. Returned shape is stable — additive
// only.

export function requestSignals(request = '', context = {}) {
  const text = String(request).toLowerCase();
  const riskFlags = detectRiskFlags(request);
  const intent = classifyIntent(request);
  const workCategory = classifyWorkCategory(request, riskFlags);

  const ambiguityIndicators = [
    'maybe', 'something like', 'figure out', 'somehow', 'sort of', 'kind of', 'idea', 'rough', 'tbd',
    'we should probably', 'not sure', 'thinking about',
  ];
  const namedConstraintIndicators = [
    'must not', 'cannot exceed', 'has to', 'deadline', 'budget', 'within', 'no later than',
    'maximum', 'minimum', 'sla', 'p95', 'p99',
  ];
  const blastRadiusWide = [
    'all users', 'every user', 'global', 'org-wide', 'company-wide', 'breaking change',
    'migration', 'mass update', 'backfill', 'destructive',
  ];
  const blastRadiusMedium = [
    'feature flag', 'beta cohort', 'experiment', 'rollout', 'shadow',
  ];

  const ambiguityHits = ambiguityIndicators.filter((kw) => text.includes(kw)).length;
  const ambiguityScore = Math.min(1, ambiguityHits / 3);

  let blastRadius = 'narrow';
  if (containsAny(text, blastRadiusWide)) blastRadius = 'wide';
  else if (containsAny(text, blastRadiusMedium)) blastRadius = 'medium';

  // Registry-declared signal dimensions (lib/orchestration/signal-dimensions.mjs)
  // computed generically so adding a dimension needs no edit here.
  const dimensionSignals = {};
  for (const { key, keywords } of loadSignalDimensions()) {
    dimensionSignals[key] = containsAny(text, keywords);
  }

  return {
    intent,
    workCategory,
    riskFlags,
    ambiguityScore,
    hasSuccessMetric: containsAny(text, ['success metric', 'kpi', 'target metric', 'goal metric', 'acceptance criteria']),
    hasNamedConstraints: containsAny(text, namedConstraintIndicators),
    blastRadius,
    authOrPayments: containsAny(text, ['auth', 'authentication', 'authorization', 'payment', 'pii', 'personal data', 'compliance']),
    visualDeliverable: isVisualDeliverableRequest(text),
    namedUsers: context?.namedUsers || [],
    ...dimensionSignals,
  };
}

// Signal-driven proactive triggers. Returns a list of { specialist, reason }
// pairs for specialists that should engage PRE-DISPATCH based on signals —
// separate from the keyword-only paths in selectSpecialists. The watch
// predicates and their specialist owners are declared in
// registry (watchConditions) and evaluated by
// orchestration/routing-tables.mjs.

export function proactiveTriggers(signals) {
  return evaluateWatchConditions(signals).map(({ workerProfile, reason }) => ({ workerProfile, reason }));
}

// Format active flavor overlays into a one-line trace, e.g.
//   "Overlays: architect=platform (matched kubernetes, infra), engineer=ai (matched llm, agent)"

export function formatOverlayTrace(roleFlavors = {}, request = '') {
  const text = String(request).toLowerCase();
  const active = Object.entries(roleFlavors).filter(([, flavor]) => flavor);
  if (active.length === 0) return '';
  const FLAVOR_KEYWORDS = {
    architect: ['agent', 'rag', 'retrieval', 'embedding', 'integration', 'webhook', 'warehouse', 'schema', 'sso', 'rbac', 'platform', 'kubernetes', 'infra'],
    productManager: ['platform', 'api', 'enterprise', 'ai product', 'agent', 'growth', 'activation'],
    qa: ['agent', 'prompt', 'api', 'sdk', 'pipeline', 'etl', 'ui', 'ux', 'accessibility'],
    security: ['prompt injection', 'privacy', 'pii', 'dependency', 'cloud', 'iam', 'auth', 'xss', 'csrf'],
    dataAnalyst: ['experiment', 'a/b', 'telemetry', 'metric', 'funnel'],
    dataEngineer: ['vector', 'embedding', 'warehouse', 'pipeline', 'etl', 'pgvector'],
    engineer: ['llm', 'agent', 'rag', 'kubernetes', 'k8s', 'terraform', 'infra', 'docker', 'pipeline', 'etl', 'data model'],
  };
  const parts = active.map(([role, flavor]) => {
    const kws = (FLAVOR_KEYWORDS[role] || []).filter((kw) => text.includes(kw));
    const matched = kws.slice(0, 3).join(', ');
    return matched ? `${role}=${flavor} (matched ${matched})` : `${role}=${flavor}`;
  });
  return `Overlays: ${parts.join(', ')}`;
}

/**
 * @typedef {object} RoutePath
 * @property {string[]} assignmentSequence - ordered Assignment ids.
 * @property {Array<{contract:object, stage:string, skillHints:string[]}>} contractChain
 *   - typed handoff chain for this route, the SAME array resolveContractChain
 *   already produced (route.contractChain) — reused by reference, not
 *   recomputed.
 * @property {object} sourcePolicy - which routing table/rule decided this
 *   route: the keyword intent classification, any doc-authoring owner
 *   override, the proactive watch-condition triggers that fired
 *   (routing-tables.mjs), and the policies governing the assignments.
 * @property {string} rationale - one-line human-readable explanation of the
 *   route decision, assembled from the same signals sourcePolicy records.
 */

// Builds the routePath payload from fields routeRequest already computed —
// no new classification here, just naming and packaging what selectWorkerProfiles/
// resolveContractChain/policyRoutingForWorkerProfiles/proactiveTriggers produced so
// CLI, MCP, traces, and handoffs can surface "why this route" without each
// reimplementing the same read of route internals.

function buildRoutePath({
  intent, docAuthoring, externalResearch, framingChallenge, triggers = [], policyRouting, assignments = [], contractChain = [],
} = {}) {
  const sourcePolicy = {
    intentClassification: intent,
    docAuthoringOverride: docAuthoring?.owner
      ? { owner: docAuthoring.owner, docType: docAuthoring.docType ?? null }
      : null,
    // triggers (proactiveTriggers()'s output) already dropped the watcher name —
    // only Worker Profile and reason survive that layer, so sourcePolicy mirrors the
    // same two fields rather than a phantom always-undefined watcher key.
    watchConditionTriggers: triggers.map(({ workerProfile, reason }) => ({ workerProfile, reason })),
    policies: policyRouting?.policies ?? [],
  };

  const rationaleParts = [`intent=${intent}`];
  if (docAuthoring?.docType) rationaleParts.push(`doc-authoring=${docAuthoring.docType}`);
  if (externalResearch?.required) rationaleParts.push(`external-research=${externalResearch.reason}`);
  if (framingChallenge?.required) rationaleParts.push(`framing-challenge=${framingChallenge.reason}`);
  if (policyRouting?.policies?.length) rationaleParts.push(`policies=${policyRouting.policies.join(',')}`);
  if (triggers.length) rationaleParts.push(`proactive=${triggers.map((t) => t.workerProfile).join(',')}`);

  return {
    assignmentSequence: assignments.map((assignment) => assignment.id),
    contractChain,
    sourcePolicy,
    rationale: `Routed by ${rationaleParts.join('; ')}`,
  };
}

export function routeRequest(options = {}) {
  const intent = classifyIntent(options.request);
  const riskFlags = detectRiskFlags(options.request);
  const roleFlavors = classifyRoleFlavors(options.request);
  const productFlavor = isProductIntelligenceRequest(options.request)
    ? classifyProductManagerFlavor(options.request)
    : null;
  const workCategory = classifyWorkCategory(options.request, riskFlags);
  const track = determineExecutionTrack({ ...options, riskFlags });
  const docAuthoring = detectDocAuthoringIntent(options.request);
  const docAuthoringItems = detectDocAuthoringItems(options.request);
  const externalResearch = requiresExternalResearch({ request: options.request, workCategory, riskFlags });
  const framingChallenge = requiresFramingChallenge({ request: options.request, workCategory, riskFlags, introducesContract: options.introducesContract });
  const artifactReview = resolveArtifactReviewRequirements(docAuthoring);
  const suggestedWorkflowType = suggestWorkflowType({ intent, request: options.request, docAuthoring });
  const researchExecutionPolicy = intent === INTENT_CLASSES.research || externalResearch?.required
    ? buildResearchExecutionPolicy({ request: options.request })
    : null;
  const signals = requestSignals(options.request, options.context);
  const triggers = proactiveTriggers(signals);
  const reasons = {};
  for (const { workerProfile, reason } of triggers) {
    reasons[workerProfile] = reason;
  }

  const augmentOpts = {
    request: options.request,
    docAuthoring,
    externalResearch,
    framingChallenge,
    artifactReview,
    triggers,
  };

  let workerProfiles = augmentWorkerProfiles(
    selectWorkerProfiles({ ...options, intent, track, riskFlags, workCategory }),
    augmentOpts,
  );

  const policyTrack = track === EXECUTION_TRACKS.immediate ? EXECUTION_TRACKS.focused : track;
  let policyWorkerProfiles = augmentWorkerProfiles(
    selectWorkerProfiles({ ...options, intent, track: policyTrack, riskFlags, workCategory }),
    augmentOpts,
  );
  if (detectTeamChain(options.request).length < 2) {
    policyWorkerProfiles = enrichPolicyForProjectQuestion(options.request, policyWorkerProfiles);
  }

  const contractWorkerProfiles = workerProfiles.length ? workerProfiles : policyWorkerProfiles;
  const assignments = workerProfiles.map((workerProfileId, index) => ({
    id: `assignment-${index + 1}`,
    workerProfileId,
    reason: reasons[workerProfileId] ?? null,
    recruited: Boolean(reasons[workerProfileId]),
  }));

  const contractChain = resolveContractChain({
    intent,
    workCategory,
    track,
    riskFlags,
    workerProfiles: contractWorkerProfiles,
    framingChallenge,
    externalResearch,
    docAuthoring,
    artifactReview,
  });

  // Policy routing: analyze Worker Profile ownership, required approvals, and escalation paths.
  const policyRouting = policyRoutingForWorkerProfiles(contractWorkerProfiles, {
    intent,
    request: options.request,
    cwd: options.cwd ?? null,
    docAuthoring,
  });

  const mandatoryWorkerProfiles = workerProfiles.length ? workerProfiles : policyWorkerProfiles;
  const advisoryAssignments = buildAdvisoryAssignments({
    signals,
    mandatoryWorkerProfiles,
    kind: 'review',
    cwd: options.cwd ?? null,
  });
  const directExecution = track === EXECUTION_TRACKS.immediate && assignments.length === 0;

  const routePath = buildRoutePath({
    intent, docAuthoring, externalResearch, framingChallenge, triggers, policyRouting, assignments, contractChain,
  });

  const route = {
    intent,
    workCategory,
    track,
    riskFlags,
    productFlavor,
    roleFlavors,
    assignments,
    advisoryAssignments,
    directExecution,
    signals,
    triggers,
    dispatchReasons: reasons,
    docAuthoring,
    ...(docAuthoringItems.length ? { docAuthoringItems } : {}),
    externalResearch,
    framingChallenge,
    artifactReview,
    suggestedWorkflowType,
    researchExecutionPolicy,
    contractChain,
    policyRouting,
    routePath,
  };

  if (process.env.CONSTRUCT_VERBOSE === '1' && triggers.length > 0) {
    for (const { workerProfile, reason } of triggers) {
      console.error(`[route] proactive: ${workerProfile} (${reason})`);
    }
  }

  return route;
}

// Sync wrapper that returns the keyword route immediately and fires the
// LLM intent verifier in the background. The verifier writes its verdict
// to ~/.construct/intent-verifications.jsonl for offline tuning; the dispatched
// route never waits on a model round-trip. Disable the background call
// entirely with CONSTRUCT_INTENT_VERIFY=off — see lib/intent-classifier.mjs.
export function routeRequestVerified(options = {}) {
  const route = routeRequest(options);
  return verifyRoute(route, { request: options.request, modelCaller: options.modelCaller });
}

/**
 * Build the construct→orchestrator contract packet (registry).
 * Callers must pass this object to agent_contract — not a bare goal string.
 */
export function buildConstructToOrchestratorPacket(options = {}) {
  const request = String(options.request || '');
  const route = options.route || routeRequest({
    request,
    fileCount: options.fileCount ?? 0,
    moduleCount: options.moduleCount ?? 0,
    introducesContract: options.introducesContract ?? false,
    explicitDrive: options.explicitDrive ?? false,
  });
  if (route.track === EXECUTION_TRACKS.immediate) return null;

  const goal = String(options.goal || request || '').trim() || 'User-requested work';
  const acceptanceCriteria = Array.isArray(options.acceptanceCriteria) && options.acceptanceCriteria.length
    ? options.acceptanceCriteria
    : ['Dispatch plan emitted with Worker Profiles in sequence', 'Acceptance criteria verified before close'];

  return {
    goal,
    intent: route.intent,
    workCategory: route.workCategory,
    riskFlags: route.riskFlags || {},
    suggestedWorkflowType: route.suggestedWorkflowType || null,
    acceptanceCriteria,
    routePath: route.routePath || null,
  };
}
