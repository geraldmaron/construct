/**
 * lib/orchestration-policy.mjs — provider-agnostic routing and escalation policy.
 */

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
  if (riskFlags.ui) return WORK_CATEGORIES.visual;
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
  if (explicitDrive) return EXECUTION_TRACKS.orchestrated;
  if (intent === INTENT_CLASSES.research && fileCount <= 1 && moduleCount <= 1) return EXECUTION_TRACKS.immediate;
  if (introducesContract || fileCount >= 3 || moduleCount >= 2) return EXECUTION_TRACKS.orchestrated;
  if (riskFlags.architecture || riskFlags.security || riskFlags.dataIntegrity || riskFlags.ai) return EXECUTION_TRACKS.orchestrated;
  if (fileCount <= 1 && moduleCount <= 1 && !includesAny(String(request).toLowerCase(), [/end to end/, /ship/, /full/])) return EXECUTION_TRACKS.immediate;
  return EXECUTION_TRACKS.focused;
}

export function selectSpecialists({ request = '', intent, track, riskFlags = detectRiskFlags(request) } = {}) {
  const text = String(request).toLowerCase();
  const productRequest = isProductIntelligenceRequest(text);
  const dataAnalysisRequest = isDataAnalysisRequest(text);
  const dataEngineeringRequest = isDataEngineeringRequest(text);
  if (track === EXECUTION_TRACKS.immediate) return [];
  if (track === EXECUTION_TRACKS.focused) {
    if (riskFlags.ui) return ['cx-designer'];
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
  if (riskFlags.ui) specialists.push('cx-designer');
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
  const specialists = selectSpecialists({ ...options, intent, track, riskFlags });
  return {
    intent,
    workCategory,
    track,
    riskFlags,
    productFlavor,
    roleFlavors,
    specialists,
    dispatchPlan: buildDispatchPlan({ track, intent, specialists }),
  };
}
