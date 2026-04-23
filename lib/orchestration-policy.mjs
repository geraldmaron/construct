/**
 * lib/orchestration-policy.mjs — provider-agnostic routing and escalation policy.
 *
 * Routing surfaces three things every call:
 *   1. execution track + specialist list  (who runs, in what order)
 *   2. framing/research/doc-ownership gates  (what must be true before work starts)
 *   3. contract chain (resolveContractChain)  (what the typed handoffs are)
 *
 * Agent-to-agent contracts are defined in agents/contracts.json and loaded via
 * lib/agent-contracts.mjs. That file is the single source of truth for
 * producer→consumer expectations, replacing the scattered DOC_OWNERSHIP map,
 * SPECIALIST_MAP, and informal "collaborators" lists for anything contract-
 * shaped. The older maps remain for quick lookups but defer to contracts.json
 * for authoritative semantics.
 */
import { resolveContractChain } from './agent-contracts.mjs';

export const EXECUTION_TRACKS = {
  immediate: 'immediate',
  focused: 'focused',
  orchestrated: 'orchestrated',
};

export const INTENT_CLASSES = {
  research: 'research',
  implementation: 'implementation',
  investigation: 'investigation',
  evaluation: 'evaluation',
  fix: 'fix',
};

export const WORK_CATEGORIES = {
  visual: 'visual',
  deep: 'deep',
  quick: 'quick',
  writing: 'writing',
  analysis: 'analysis',
};

export const TERMINAL_STATES = ['DONE', 'BLOCKED', 'NEEDS_MAIN_INPUT'];

/**
 * Maps document types to the specialist that owns authoring them.
 * Construct (or any general persona) must route to the owner rather than
 * authoring these directly — authoring is how the owner's domain checks
 * (framing, research, trade-off analysis) actually fire.
 *
 * Keep in sync with rules/common/doc-ownership.md.
 */
export const DOC_OWNERSHIP = {
  prd: 'cx-product-manager',
  'meta-prd': 'cx-product-manager',
  'prd-platform': 'cx-product-manager',
  'prd-business': 'cx-product-manager',
  prfaq: 'cx-product-manager',
  'one-pager': 'cx-product-manager',
  'backlog-proposal': 'cx-product-manager',
  'customer-profile': 'cx-product-manager',
  adr: 'cx-architect',
  rfc: 'cx-architect',
  'rfc-platform': 'cx-architect',
  'architecture-overview': 'cx-architect',
  'system-design': 'cx-architect',
  'research-brief': 'cx-researcher',
  'evidence-brief': 'cx-researcher',
  'signal-brief': 'cx-researcher',
  'product-intelligence-report': 'cx-researcher',
  runbook: 'cx-sre',
  'incident-report': 'cx-sre',
  postmortem: 'cx-sre',
  'test-plan': 'cx-qa',
  'qa-strategy': 'cx-qa',
  'security-review': 'cx-security',
  'threat-model': 'cx-security',
  memo: 'cx-docs-keeper',
  changelog: 'cx-docs-keeper',
};

const DOC_AUTHORING_PATTERNS = [
  { pattern: /\b(adr|architecture decision record)s?\b/i, docType: 'adr' },
  { pattern: /\bmeta[\s-]prd\b/i, docType: 'meta-prd' },
  { pattern: /\bplatform prd\b/i, docType: 'prd-platform' },
  { pattern: /\bbusiness prd\b/i, docType: 'prd-business' },
  { pattern: /\bprd\b|\bproduct requirements? document/i, docType: 'prd' },
  { pattern: /\bprfaq\b|\bpress release.*faq/i, docType: 'prfaq' },
  { pattern: /\bone[\s-]pager\b/i, docType: 'one-pager' },
  { pattern: /\bbacklog proposal/i, docType: 'backlog-proposal' },
  { pattern: /\bcustomer profile/i, docType: 'customer-profile' },
  { pattern: /\brfc\b|\brequest for comments?\b/i, docType: 'rfc' },
  { pattern: /\barchitecture overview/i, docType: 'architecture-overview' },
  { pattern: /\bsystem design/i, docType: 'system-design' },
  { pattern: /\bresearch brief/i, docType: 'research-brief' },
  { pattern: /\bevidence brief/i, docType: 'evidence-brief' },
  { pattern: /\bsignal brief/i, docType: 'signal-brief' },
  { pattern: /\bproduct intelligence report/i, docType: 'product-intelligence-report' },
  { pattern: /\brunbook/i, docType: 'runbook' },
  { pattern: /\bincident report/i, docType: 'incident-report' },
  { pattern: /\bpostmortem|\bpost[\s-]mortem/i, docType: 'postmortem' },
  { pattern: /\btest plan/i, docType: 'test-plan' },
  { pattern: /\bqa strategy/i, docType: 'qa-strategy' },
  { pattern: /\bthreat model/i, docType: 'threat-model' },
  { pattern: /\bsecurity review/i, docType: 'security-review' },
  { pattern: /\bchangelog/i, docType: 'changelog' },
];

const AUTHORING_VERBS = /\b(write|writing|draft|drafting|create|creating|author|authoring|produce|producing|compose|composing|prepare|preparing)\b/i;

/**
 * Detects whether the request is asking for authorship of a typed document
 * that has a canonical owner. Returns `{ docType, owner }` when matched,
 * or null otherwise.
 */
export function detectDocAuthoringIntent(request = '') {
  const text = String(request);
  if (!AUTHORING_VERBS.test(text)) return null;
  for (const { pattern, docType } of DOC_AUTHORING_PATTERNS) {
    if (pattern.test(text)) {
      return { docType, owner: DOC_OWNERSHIP[docType] ?? null };
    }
  }
  return null;
}

const PROPER_NOUN_STOPLIST = new Set([
  'I', 'A', 'An', 'The', 'This', 'That', 'These', 'Those', 'My', 'Our', 'Your',
  'We', 'They', 'He', 'She', 'It', 'Please', 'Thanks', 'Hi', 'Hello',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Construct', 'Claude', 'GPT', 'OpenAI', 'Anthropic', 'GitHub', 'Google', 'Microsoft',
]);

/**
 * Extracts proper-noun candidates from a request — capitalized tokens that are
 * not common English words, day/month names, or known product/company names.
 * Used to detect named entities that likely require external research.
 */
export function extractNamedEntities(request = '') {
  const text = String(request);
  const tokens = new Set();
  // CamelCase single words (e.g. "ProjectIverson")
  for (const match of text.matchAll(/\b[A-Z][a-z]+[A-Z][A-Za-z]+\b/g)) tokens.add(match[0]);
  // Capitalized multi-word sequences (e.g. "Project Iverson")
  for (const match of text.matchAll(/\b([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,})){1,4}\b/g)) tokens.add(match[0]);
  // Single capitalized words not at sentence start
  for (const match of text.matchAll(/(?<=[a-z,;:]\s)[A-Z][a-z]{3,}\b/g)) tokens.add(match[0]);
  return Array.from(tokens).filter((token) => {
    const head = token.split(/\s+/)[0];
    return !PROPER_NOUN_STOPLIST.has(head);
  });
}

/**
 * Returns whether external research is required before scaffolding, with the
 * reason. Triggered by named entities not in the project glossary, or by
 * architecture / writing / research-driven work regardless of entities.
 */
export function requiresExternalResearch({ request = '', workCategory, riskFlags } = {}) {
  const entities = extractNamedEntities(request);
  const category = workCategory ?? classifyWorkCategory(request);
  const flags = riskFlags ?? detectRiskFlags(request);
  if (entities.length > 0) {
    return { required: true, reason: 'named-entities', entities };
  }
  if (category === WORK_CATEGORIES.writing || flags.architecture || flags.docs) {
    return { required: true, reason: 'writing-or-architecture' };
  }
  // Research intent alone doesn't force external-source research — a simple
  // code walkthrough ("explain how X works") is research intent but doesn't
  // need primary-source citations. Only fire when combined with a broader
  // scope that implies the answer isn't in the immediate code context.
  return { required: false };
}

/**
 * Returns whether the request must pass a framing challenge
 * (cx-devil-advocate or cx-architect problem-reframing) before scaffolding.
 * Fires for architecture work, documentation sets, and any research-driven
 * artifact. Fail-closed: when in doubt, require the challenge.
 */
export function requiresFramingChallenge({ request = '', workCategory, riskFlags, introducesContract = false } = {}) {
  const category = workCategory ?? classifyWorkCategory(request);
  const flags = riskFlags ?? detectRiskFlags(request);
  if (flags.architecture || introducesContract) return { required: true, reason: 'architecture-or-contract' };
  if (category === WORK_CATEGORIES.writing && flags.docs) return { required: true, reason: 'documentation-set' };
  if (isProductIntelligenceRequest(request)) return { required: true, reason: 'product-intelligence' };
  if (detectDocAuthoringIntent(request)) return { required: true, reason: 'typed-document' };
  return { required: false };
}

const SPECIALIST_MAP = {
  implementation: ['cx-engineer'],
  investigation: ['cx-debugger', 'cx-engineer'],
  evaluation: ['cx-reviewer'],
  fix: ['cx-debugger', 'cx-engineer'],
  research: ['cx-researcher'],
};

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function containsAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function isProductIntelligenceRequest(request = '') {
  const text = String(request).toLowerCase();
  return containsAny(text, [
    'requirements',
    'prd',
    'prfaq',
    'product brief',
    'signal brief',
    'customer notes',
    'customer profile',
    'product intelligence',
    'backlog proposal',
    'jira proposal',
    'linear proposal',
    'field notes',
    'product spec',
    'meta prd',
  ]);
}

export function classifyProductManagerFlavor(request = '') {
  const text = String(request).toLowerCase();
  if (containsAny(text, ['platform', 'api', 'sdk', 'developer experience', 'devex', 'integration', 'migration', 'compatibility', 'admin', 'tenant'])) return 'platform';
  if (containsAny(text, ['enterprise', 'procurement', 'compliance', 'security review', 'audit', 'sso', 'soc2', 'soc 2', 'rbac'])) return 'enterprise';
  if (containsAny(text, ['ai product', 'agent', 'eval', 'evaluation loop', 'model behavior', 'prompt', 'llm', 'human review'])) return 'ai-product';
  if (containsAny(text, ['growth', 'activation', 'conversion', 'funnel', 'packaging', 'pricing', 'gtm', 'go-to-market'])) return 'growth';
  return 'product';
}

export function classifyArchitectFlavor(request = '') {
  const text = String(request).toLowerCase();
  if (containsAny(text, ['agent', 'rag', 'retrieval', 'embedding', 'eval loop', 'model behavior', 'tool use', 'llm'])) return 'ai-systems';
  if (containsAny(text, ['integration', 'webhook', 'sync', 'third-party', 'oauth', 'reconciliation', 'idempotency'])) return 'integration';
  if (containsAny(text, ['warehouse', 'schema', 'migration', 'retention', 'index', 'backfill', 'data model'])) return 'data';
  if (containsAny(text, ['enterprise', 'sso', 'rbac', 'audit', 'data residency', 'procurement', 'tenant isolation'])) return 'enterprise';
  if (containsAny(text, ['platform', 'api', 'sdk', 'developer experience', 'devex', 'admin', 'tenant', 'compatibility'])) return 'platform';
  return null;
}

export function classifyQaFlavor(request = '') {
  const text = String(request).toLowerCase();
  if (containsAny(text, ['agent', 'prompt', 'model', 'eval', 'rag', 'retrieval', 'golden trace'])) return 'ai-eval';
  if (containsAny(text, ['api', 'sdk', 'contract', 'status code', 'error body', 'openapi', 'consumer'])) return 'api-contract';
  if (containsAny(text, ['pipeline', 'etl', 'elt', 'backfill', 'freshness', 'data quality', 'warehouse'])) return 'data-pipeline';
  if (containsAny(text, ['ui', 'ux', 'screen', 'browser', 'playwright', 'responsive', 'keyboard', 'accessibility', 'visual'])) return 'web-ui';
  return null;
}

export function classifySecurityFlavor(request = '') {
  const text = String(request).toLowerCase();
  if (containsAny(text, ['prompt injection', 'agent', 'rag', 'retrieval', 'embedding', 'model', 'tool scoping'])) return 'ai';
  if (containsAny(text, ['privacy', 'pii', 'retention', 'deletion', 'consent', 'telemetry', 'trace', 'export'])) return 'privacy';
  if (containsAny(text, ['dependency', 'package', 'supply chain', 'sbom', 'provenance', 'ci permission', 'signing'])) return 'supply-chain';
  if (containsAny(text, ['cloud', 'iam', 'bucket', 'network policy', 'encryption', 'public access', 'drift'])) return 'cloud';
  if (containsAny(text, ['auth', 'authorization', 'xss', 'csrf', 'ssrf', 'injection', 'input validation', 'jwt'])) return 'appsec';
  return null;
}

export function classifyDataAnalystFlavor(request = '') {
  const text = String(request).toLowerCase();
  if (containsAny(text, ['customer signal', 'customer notes', 'evidence brief', 'product intelligence', 'field notes', 'signal brief'])) return 'product-intelligence';
  if (containsAny(text, ['experiment', 'a/b', 'ab test', 'randomization', 'sample size', 'mde'])) return 'experiment';
  if (containsAny(text, ['telemetry', 'trace', 'logs', 'dashboard', 'observability', 'denominator'])) return 'telemetry';
  if (containsAny(text, ['metric', 'funnel', 'activation', 'adoption', 'retention', 'conversion', 'guardrail'])) return 'product';
  return null;
}

export function classifyDataEngineerFlavor(request = '') {
  const text = String(request).toLowerCase();
  if (containsAny(text, ['vector', 'embedding', 'retrieval', 'hybrid search', 'semantic search', 'pgvector'])) return 'vector-retrieval';
  if (containsAny(text, ['warehouse', 'metric layer', 'semantic layer', 'dimensional', 'partition', 'incremental model'])) return 'warehouse';
  if (containsAny(text, ['pipeline', 'etl', 'elt', 'streaming', 'backfill', 'idempotent', 'data contract'])) return 'pipeline';
  return null;
}

export function isDataAnalysisRequest(request = '') {
  return Boolean(classifyDataAnalystFlavor(request));
}

export function isDataEngineeringRequest(request = '') {
  return Boolean(classifyDataEngineerFlavor(request));
}

export function isVisualDeliverableRequest(request = '') {
  const text = String(request).toLowerCase();
  return containsAny(text, [
    'wireframe',
    'diagram',
    'flowchart',
    'mermaid',
    'sequence diagram',
    'state diagram',
    'er diagram',
    'mockup',
    'storyboard',
    'deck',
    'slide deck',
    'slides',
    'presentation',
    'powerpoint',
    'ppt',
    'pptx',
    'walkthrough video',
    'demo video',
  ]);
}

export function classifyRoleFlavors(request = '') {
  return {
    architect: classifyArchitectFlavor(request),
    productManager: isProductIntelligenceRequest(request) ? classifyProductManagerFlavor(request) : null,
    qa: classifyQaFlavor(request),
    security: classifySecurityFlavor(request),
    dataAnalyst: classifyDataAnalystFlavor(request),
    dataEngineer: classifyDataEngineerFlavor(request),
  };
}

export function detectRiskFlags(request = '') {
  const text = String(request).toLowerCase();
  return {
    architecture: containsAny(text, ['architecture', 'interface contract', 'api contract', 'dependency', 'module boundary', 'data model', 'indexing', 'retrieval design']),
    security: containsAny(text, ['security', 'permission', 'secret', 'privacy', 'payment', 'authentication', 'authorization']),
    dataIntegrity: containsAny(text, ['migration', 'data', 'sync', 'consistency', 'state']),
    ui: containsAny(text, ['ui', 'ux', 'design system', 'screen', 'layout', 'visual', 'onboarding']) && !containsAny(text, ['requirements']),
    docs: containsAny(text, ['docs', 'readme', 'runbook', 'adr']),
    ai: containsAny(text, ['llm', ' agent', 'prompt', 'rag', 'model behavior', 'retrieval', 'embedding', 'vector']),
  };
}

export function classifyIntent(request = '') {
  const text = String(request).toLowerCase();
  if (containsAny(text, ['fix', 'bug', 'regression', 'broken', 'repair'])) return INTENT_CLASSES.fix;
  if (includesAny(text, [/debug/, /investigate/, /trace/, /root cause/, /why .* fail/])) return INTENT_CLASSES.investigation;
  if (isProductIntelligenceRequest(text)) return INTENT_CLASSES.implementation;
  if (includesAny(text, [/review/, /audit/, /validate/, /ready to ship/, /check/])) return INTENT_CLASSES.evaluation;
  if (includesAny(text, [/research/, /explore/, /compare/, /what does/, /explain/, /understand/, /docs?/])) return INTENT_CLASSES.research;
  return INTENT_CLASSES.implementation;
}

export function classifyWorkCategory(request = '', riskFlags = detectRiskFlags(request)) {
  const text = String(request).toLowerCase();
  if (riskFlags.ui || isVisualDeliverableRequest(text)) return WORK_CATEGORIES.visual;
  if (riskFlags.docs || containsAny(text, ['write', 'rewrite', 'document', 'spec', 'requirements'])) return WORK_CATEGORIES.writing;
  if (includesAny(text, [/analy[sz]e/, /measure/, /metrics/, /score/, /evaluate/])) return WORK_CATEGORIES.analysis;
  if (riskFlags.architecture || riskFlags.ai || includesAny(text, [/plan/, /strategy/, /system/, /refactor/, /orchestr/])) return WORK_CATEGORIES.deep;
  return WORK_CATEGORIES.quick;
}

export function determineExecutionTrack({
  request = '',
  fileCount = 0,
  moduleCount = 0,
  introducesContract = false,
  explicitDrive = false,
  riskFlags = detectRiskFlags(request),
} = {}) {
  const intent = classifyIntent(request);
  const workCategory = classifyWorkCategory(request, riskFlags);
  if (explicitDrive) return EXECUTION_TRACKS.orchestrated;
  if (intent === INTENT_CLASSES.research && fileCount <= 1 && moduleCount <= 1) return EXECUTION_TRACKS.immediate;
  if (introducesContract || fileCount >= 3 || moduleCount >= 2) return EXECUTION_TRACKS.orchestrated;
  if (riskFlags.architecture || riskFlags.security || riskFlags.dataIntegrity || riskFlags.ai) return EXECUTION_TRACKS.orchestrated;
  if (workCategory === WORK_CATEGORIES.visual) return EXECUTION_TRACKS.focused;
  if (fileCount <= 1 && moduleCount <= 1 && !includesAny(String(request).toLowerCase(), [/end to end/, /ship/, /full/])) return EXECUTION_TRACKS.immediate;
  return EXECUTION_TRACKS.focused;
}

export function selectSpecialists({ request = '', intent, track, riskFlags = detectRiskFlags(request), workCategory = classifyWorkCategory(request, riskFlags) } = {}) {
  const text = String(request).toLowerCase();
  const productRequest = isProductIntelligenceRequest(text);
  const dataAnalysisRequest = isDataAnalysisRequest(text);
  const dataEngineeringRequest = isDataEngineeringRequest(text);
  if (track === EXECUTION_TRACKS.immediate) return [];
  if (track === EXECUTION_TRACKS.focused) {
    if (workCategory === WORK_CATEGORIES.visual || riskFlags.ui) return ['cx-designer'];
    if (productRequest) return ['cx-product-manager'];
    if (dataEngineeringRequest) return ['cx-data-engineer'];
    if (dataAnalysisRequest) return ['cx-data-analyst'];
    if (riskFlags.docs) return ['cx-docs-keeper'];
    if (riskFlags.security && intent === INTENT_CLASSES.evaluation) return ['cx-security'];
    return SPECIALIST_MAP[intent] || ['cx-engineer'];
  }

  const specialists = ['cx-architect'];
  if (intent === INTENT_CLASSES.fix || intent === INTENT_CLASSES.investigation) specialists.push('cx-debugger');
  if (intent === INTENT_CLASSES.research) specialists.push('cx-researcher');
  if (workCategory === WORK_CATEGORIES.visual || riskFlags.ui) specialists.push('cx-designer');
  if (productRequest) specialists.push('cx-product-manager');
  if (dataAnalysisRequest) specialists.push('cx-data-analyst');
  if (dataEngineeringRequest) specialists.push('cx-data-engineer');
  else if (riskFlags.docs) specialists.push('cx-docs-keeper');
  specialists.push('cx-engineer', 'cx-reviewer', 'cx-qa');
  if (riskFlags.security || riskFlags.dataIntegrity) specialists.push('cx-security');
  return Array.from(new Set(specialists));
}

export function requiresExecutiveApproval({
  scopeChange = false,
  productDecision = false,
  riskAcceptance = false,
  irreversibleAction = false,
  blockedDependency = false,
} = {}) {
  return Boolean(scopeChange || productDecision || riskAcceptance || irreversibleAction || blockedDependency);
}

export function buildDispatchPlan({ track, intent, specialists = [] }) {
  if (track === EXECUTION_TRACKS.immediate) return 'Plan: respond directly.';
  if (track === EXECUTION_TRACKS.focused) return `Plan: ${specialists.join(' → ')}.`;

  const phases = ['cx-architect'];
  if (intent === INTENT_CLASSES.fix || intent === INTENT_CLASSES.investigation) phases.push('cx-debugger');
  phases.push('cx-engineer');
  const validators = specialists.filter((name) => ['cx-reviewer', 'cx-qa', 'cx-security'].includes(name));
  if (validators.length) phases.push(validators.join(' + '));
  return `Plan: ${phases.join(' → ')}.`;
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
  let specialists = selectSpecialists({ ...options, intent, track, riskFlags, workCategory });
  const docAuthoring = detectDocAuthoringIntent(options.request);
  const externalResearch = requiresExternalResearch({ request: options.request, workCategory, riskFlags });
  const framingChallenge = requiresFramingChallenge({ request: options.request, workCategory, riskFlags, introducesContract: options.introducesContract });

  // Doc ownership: the owning specialist authors; orchestrator routes.
  if (docAuthoring?.owner && !specialists.includes(docAuthoring.owner)) {
    specialists = [docAuthoring.owner, ...specialists];
  }
  // External research must precede authoring.
  if (externalResearch.required && !specialists.includes('cx-researcher')) {
    specialists = ['cx-researcher', ...specialists];
  }
  // Framing challenge must precede scaffolding.
  if (framingChallenge.required && !specialists.includes('cx-devil-advocate')) {
    specialists = ['cx-devil-advocate', ...specialists];
  }
  specialists = Array.from(new Set(specialists));

  const contractChain = resolveContractChain({
    intent,
    workCategory,
    track,
    riskFlags,
    framingChallenge,
    externalResearch,
    docAuthoring,
  });

  return {
    intent,
    workCategory,
    track,
    riskFlags,
    productFlavor,
    roleFlavors,
    specialists,
    docAuthoring,
    externalResearch,
    framingChallenge,
    contractChain,
    dispatchPlan: buildDispatchPlan({ track, intent, specialists }),
  };
}
