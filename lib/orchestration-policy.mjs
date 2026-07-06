/**
 * lib/orchestration-policy.mjs — provider-agnostic routing and escalation policy.
 *
 * Routing surfaces three things every call:
 *   1. execution track + specialist list  (who runs, in what order)
 *   2. framing/research/doc-ownership gates  (what must be true before work starts)
 *   3. contract chain (resolveContractChain)  (what the typed handoffs are)
 *
 * Agent-to-agent contracts are declared in specialists/org
 * (registry.contracts) and resolved via lib/specialist-contracts.mjs. The
 * unified registry is the source of truth for producer→consumer typed handoffs.
 *
 * Event ownership, doc-artifact ownership, and watch-condition routing live
 * declaratively on specialist entries in specialists/org and are
 * resolved by lib/orchestration/routing-tables.mjs. Hardcoded maps here
 * would create a second source of truth.
 */
import { resolveContractChain } from './specialist-contracts.mjs';
import { verifyRoute } from './intent-classifier.mjs';
import { ownerForEvent, ownerForDoc, evaluateWatchConditions, knownDocTypes } from './orchestration/routing-tables.mjs';
import { getArtifactEntry, resolveArtifactWorkflowContract } from './artifact-manifest.mjs';
import { loadRegistry } from './registry/loader.mjs';
import { buildResearchExecutionPolicy } from './research-execution-policy.mjs';
import { resolveActiveScope } from './scopes/loader.mjs';
import { scopeTeamsById, resolveIntentTeamForScope, resolveScopeTeamMeta } from './scopes/teams.mjs';
import { formatOverlayLine } from './roles/flavor-bindings.mjs';

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

// RFC-0004 §2: each intent class maps to the team that naturally owns that work.
// The primary team drives ownership in teamRouting; specialist selection stays
// flavor-driven. Domain refinements the RFC notes (investigation/fix can fall to
// operations-group, research to product-group) layer on as the decision matrix
// grows — the base mapping is deterministic so routing is testable.

export const INTENT_TO_TEAM = Object.freeze({
  research: 'strategy-team',
  implementation: 'engineering-team',
  investigation: 'engineering-team',
  evaluation: 'quality-team',
  fix: 'engineering-team',
});

export const WORK_CATEGORIES = {
  visual: 'visual',
  deep: 'deep',
  quick: 'quick',
  writing: 'writing',
  analysis: 'analysis',
};

export const TERMINAL_STATES = ['DONE', 'BLOCKED', 'NEEDS_MAIN_INPUT'];

// Event and doc-artifact ownership are resolved from specialists/org
// via routing-tables.mjs. Re-exported here so callers that historically
// imported from this module keep working.

export { ownerForEvent, ownerForDoc } from './orchestration/routing-tables.mjs';

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

const AUTHORING_VERBS = /\b(write|writing|draft|drafting|create|creating|author|authoring|produce|producing|compose|composing|prepare|preparing|generate|generating)\b/i;

/**
 * Resolves a document type mentioned in text without requiring an authoring verb.
 */
export function resolveDocTypeMention(request = '') {
  const text = String(request);
  for (const { pattern, docType } of DOC_AUTHORING_PATTERNS) {
    if (pattern.test(text)) return docType;
  }
  return null;
}

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
      return { docType, owner: ownerForDoc(docType) };
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
 * Detects named entities that likely require external research.
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

// Research-shaped intent is the vocabulary of external and landscape research —
// where the answer lives in papers, vendor docs, standards, or the market, not
// in the local code. Grouped by shape so the matched kind rides on the gate
// result and the decision is traceable. A false positive here is cheap (it only
// offers the cx-researcher specialist, with no routing latency and no heavy-flow
// coupling), so the set is tuned for recall; the precision floor is that a
// code-walkthrough of the user's own system ("explain how X works") carries none
// of these terms and stays answered from local context.
const RESEARCH_SHAPE_PATTERNS = [
  ['comparative', [/\bcompare\b/, /\bcomparison\b/, /\bcompared to\b/, /\bversus\b/, /\bhead[\s-]?to[\s-]?head\b/, /\btrade[\s-]?offs?\b/, /\bpros and cons\b/, /\balternatives\b/, /\balternative to\b/]],
  ['selection', [/\bbest (approach(es)?|option|tool|library|framework|pattern|way to|method)\b/, /\bwhich\b.{0,40}\b(should|to)\b.{0,15}\b(use|choose|pick|adopt|go with)\b/, /\brecommend(ed|ation)?\b.{0,30}\b(tool|library|framework|approach|stack|way|practice)\b/, /\boptions for\b/]],
  ['landscape', [/\blandscape\b/, /\bstate[\s-]of[\s-]the[\s-]art\b/, /\bsurvey of\b/, /\boverview of\b/, /\becosystem\b/, /\bprior art\b/, /\bliterature\b/, /\bexisting (solutions|approaches|tools|work)\b/, /\bwhat'?s out there\b/]],
  ['market', [/\bmarket (research|analysis|share|size|landscape|trends?)\b/, /\bcompetitive (analysis|landscape)\b/, /\bcompetitors?\b/, /\bindustry (standard|trends?|benchmarks?)\b/, /\bpricing (comparison|models?|tiers?)\b/, /\badoption (rate|trends?)\b/]],
  ['benchmark', [/\bbenchmarks?\b/, /\bbenchmarking\b/, /\bevaluate (options|alternatives|tools|approaches)\b/, /\bperformance comparison\b/]],
  ['standards', [/\bbest practices?\b/, /\bindustry standard\b/, /\bconventions? for\b/, /\brecommended (way|approach|practice)\b/, /\brfc\s?\d+\b/, /\bspecification for\b/]],
];

/**
 * Classify a request's research shape, or null when it carries none. The
 * returned category names which kind of external research the prompt implies.
 */
export function classifyResearchShape(request = '') {
  const text = String(request).toLowerCase();
  for (const [category, patterns] of RESEARCH_SHAPE_PATTERNS) {
    if (includesAny(text, patterns)) return category;
  }
  return null;
}

// Live web access is distinct from research-shape: a bare "connect to the
// internet" or "fetch example.com" carries none of the comparative/landscape
// vocabulary, so without this it falls to the immediate track and the
// orchestrator — which holds no network tools — refuses instead of dispatching
// the web-capable cx-researcher. A literal URL, an explicit online/internet
// phrase, or a fetch/scrape verb paired with a web object is the signal.

const WEB_VERB = '(?:fetch|download|open|load|read|scrape|crawl|retrieve|pull|grab|access|visit|hit|reach)';
const WEB_OBJECT = '(?:url|link|web\\s?page|web\\s?site|site|page|online|internet|web|endpoint|api)';
const LIVE_WEB_ACCESS_PATTERNS = [
  /https?:\/\/\S+/i,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i,
  /\b(?:connect|connecting|connection)\s+to\s+the\s+(?:internet|web|network)\b/i,
  /\binternet\s+(?:access|connection|connectivity)\b/i,
  /\b(?:go|get|getting|going)\s+online\b/i,
  /\b(?:browse|browsing|surf)\b[\s\S]{0,20}\b(?:web|internet|site|page|url)\b/i,
  /\b(?:curl|wget|ping)\b/i,
  /\b(?:is|are)\b[\s\S]{0,40}\b(?:online|offline|reachable|unreachable|responding)\b/i,
  new RegExp(`\\b${WEB_VERB}\\b[\\s\\S]{0,40}\\b${WEB_OBJECT}\\b`, 'i'),
  new RegExp(`\\b${WEB_VERB}\\b[\\s\\S]{0,40}\\b[a-z0-9-]+\\.(?:com|org|net|io|dev|ai|gov|edu|co|app|info|xyz)\\b`, 'i'),
];

/**
 * Whether a request needs live external web/network access the orchestrator
 * cannot perform itself (it is a read-only router with no network tools), so it
 * must be routed to cx-researcher rather than answered immediately.
 */
export function requiresLiveWebAccess(request = '') {
  const text = String(request);
  return LIVE_WEB_ACCESS_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Returns whether external research is required before scaffolding, with the
 * reason. Triggered by named entities not in the project glossary, by
 * architecture / writing / docs work, or by research-shaped intent regardless of
 * entities.
 */
export function requiresExternalResearch({ request = '', workCategory, riskFlags } = {}) {
  const entities = extractNamedEntities(request);
  const category = workCategory ?? classifyWorkCategory(request);
  const flags = riskFlags ?? detectRiskFlags(request);
  if (requiresLiveWebAccess(request)) {
    return { required: true, reason: 'web-access' };
  }
  if (entities.length > 0) {
    return { required: true, reason: 'named-entities', entities };
  }
  if (category === WORK_CATEGORIES.writing || flags.architecture || flags.docs) {
    return { required: true, reason: 'writing-or-architecture' };
  }
  // Research-shaped intent (compare, landscape, market, standards, …) fires even
  // without a named entity, since the answer is external. Bare research intent
  // does not: a code walkthrough ("explain how X works", "understand the
  // retrieval path") carries none of these terms and stays answered from local
  // context — the distinction that keeps the gate from firing on every prompt.
  const shape = classifyResearchShape(request);
  if (shape) {
    return { required: true, reason: 'research-shaped', shape };
  }
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

const WORKFLOW_SKILL_TO_TYPE = {
  'docs/prd-workflow': 'prd-draft',
  'docs/adr-workflow': 'architecture-review',
  'docs/research-workflow': 'research-synthesis',
  'docs/evidence-ingest-workflow': 'evidence-ingest',
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

export function classifyEngineerFlavor(request = '') {
  const text = String(request).toLowerCase();
  if (containsAny(text, ['llm', 'agent', 'prompt', 'eval', 'hallucination', 'rag', 'model behavior', 'model routing'])) return 'ai';
  if (containsAny(text, ['vector', 'embedding', 'retrieval', 'warehouse', 'etl', 'elt', 'pipeline', 'streaming', 'data contract'])) return 'data';
  if (containsAny(text, ['ci/cd', ' ci ', 'build pipeline', 'build system', 'deploy', 'docker', 'kubernetes', 'terraform', 'helm', 'release pipeline', 'platform tooling', 'developer experience'])) return 'platform';
  return null;
}

export function isDataAnalysisRequest(request = '') {
  return Boolean(classifyDataAnalystFlavor(request));
}

export function isDataEngineeringRequest(request = '') {
  return Boolean(classifyDataEngineerFlavor(request));
}

// Activation detectors for specialists without a flavor classifier. Each maps
// a request to a keyword signature; an empty match leaves the specialist
// dormant unless an event in EVENT_OWNERSHIP fires.

export function isLegalComplianceRequest(request = '') {
  const text = String(request).toLowerCase();
  return containsAny(text, [
    'legal review', 'compliance review', 'regulatory', 'gdpr', 'ccpa', 'hipaa',
    'soc 2', 'soc2', 'data processing agreement', 'dpa', 'terms of service',
    'license compliance', 'open-source license', 'attribution requirement',
    'privacy policy', 'consent flow', 'data residency', 'export control',
  ]);
}

export function isBusinessStrategyRequest(request = '') {
  const text = String(request).toLowerCase();
  return containsAny(text, [
    'go-to-market', 'gtm strategy', 'market positioning', 'competitive analysis',
    'business case', 'value proposition', 'pricing strategy', 'market segmentation',
    'investment thesis', 'strategic direction',
  ]);
}

export function isOperationsPlanningRequest(request = '') {
  const text = String(request).toLowerCase();
  return containsAny(text, [
    'dependency sequencing', 'critical path', 'milestone plan',
    'resource allocation', 'capacity planning', 'roadmap sequencing',
    'cross-team dependency', 'multi-quarter plan', 'rollout sequencing',
  ]);
}

export function isRdLeadRequest(request = '') {
  const text = String(request).toLowerCase();
  return containsAny(text, [
    'hypothesis', 'falsifiable', 'research question', 'experimental design',
    'technology spike', 'feasibility study', 'proof of concept', 'r&d',
  ]);
}

export function isExplorerRequest(request = '') {
  const text = String(request).toLowerCase();
  return containsAny(text, [
    'explore the', 'spike', 'walkthrough', 'code walk', 'scoping pass',
    'recon', 'reconnaissance', 'survey the code', 'orient me',
  ]);
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
  const engineerFlavor = classifyEngineerFlavor(request);
  const dataEngineerFlavor = classifyDataEngineerFlavor(request);
  return {
    engineer: engineerFlavor && !['ai', 'platform', 'data'].includes(engineerFlavor) ? engineerFlavor : null,
    aiEngineer: engineerFlavor === 'ai' ? 'core' : null,
    platformEngineer: engineerFlavor === 'platform' ? 'core' : null,
    architect: classifyArchitectFlavor(request),
    productManager: isProductIntelligenceRequest(request) ? classifyProductManagerFlavor(request) : null,
    qa: classifyQaFlavor(request),
    security: classifySecurityFlavor(request),
    dataAnalyst: classifyDataAnalystFlavor(request),
    dataEngineer: dataEngineerFlavor,
    businessStrategist: isBusinessStrategyRequest(request) ? 'core' : null,
  };
}

// One line per non-null flavor: "cx-<role>: loaded <role>.<flavor>
// overlay". Verbose host surfaces + cx_trace span attribute; lets a
// post-hoc reviewer see which overlays drove a given dispatch.

export function formatOverlaySelection(roleFlavors) {
  if (!roleFlavors || typeof roleFlavors !== 'object') return [];
  const lines = [];
  for (const [classifierKey, flavor] of Object.entries(roleFlavors)) {
    const line = formatOverlayLine(classifierKey, flavor);
    if (line) lines.push(line);
  }
  return lines;
}

export function detectRiskFlags(request = '') {
  const text = String(request).toLowerCase();
  return {
    architecture: containsAny(text, ['architecture', 'interface contract', 'api contract', 'dependency', 'module boundary', 'data model', 'indexing', 'retrieval design', 'terraform', 'infrastructure', 'iac', 'provisioning', 'blast radius', 'rollout', 'deployment strategy']),
    security: containsAny(text, ['security', 'permission', 'secret', 'privacy', 'payment', 'authentication', 'authorization', 'credential', 'oidc', 'iam', 'access token']),
    dataIntegrity: containsAny(text, ['migration', 'data', 'sync', 'consistency', 'state', 'tfstate', 'drift']),
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
  const text = String(request).toLowerCase();
  const localWalkthrough = isExplorerRequest(request)
    || /\b(?:explain|understand|what does|what is)\b[\s\S]{0,60}\b(?:how\b|do\b|does\b|works?\b|flow\b|path\b|layer\b|module\b|implementation\b|code\b|function\b)/i.test(text)
    || /\bhow\b[\s\S]{0,40}\bworks?\b/i.test(text);
  if (explicitDrive) return EXECUTION_TRACKS.orchestrated;
  if (intent === INTENT_CLASSES.research) {
    if (localWalkthrough && fileCount <= 1 && moduleCount <= 1) return EXECUTION_TRACKS.immediate;
    if (fileCount <= 1 && moduleCount <= 1) return EXECUTION_TRACKS.focused;
    return EXECUTION_TRACKS.orchestrated;
  }
  if (introducesContract || fileCount >= 3 || moduleCount >= 2) return EXECUTION_TRACKS.orchestrated;
  if (riskFlags.architecture || riskFlags.security || riskFlags.dataIntegrity || riskFlags.ai) return EXECUTION_TRACKS.orchestrated;
  if (workCategory === WORK_CATEGORIES.visual) return EXECUTION_TRACKS.focused;
  // A keyword that names a specialist should activate that specialist even
  // for small-scope work — otherwise the immediate-track fallback below
  // silently drops the request to "answer directly," losing the specialty.
  if (
    isLegalComplianceRequest(request)
    || isBusinessStrategyRequest(request)
    || isOperationsPlanningRequest(request)
    || isRdLeadRequest(request)
    || isExplorerRequest(request)
    || requiresLiveWebAccess(request)
  ) {
    return EXECUTION_TRACKS.focused;
  }
  if (fileCount <= 1 && moduleCount <= 1 && !includesAny(String(request).toLowerCase(), [/end to end/, /ship/, /full/])) return EXECUTION_TRACKS.immediate;
  return EXECUTION_TRACKS.focused;
}

function refineEngineeringSpecialists(specialists, request = '') {
  const engineerFlavor = classifyEngineerFlavor(request);
  if (!engineerFlavor || !['ai', 'platform', 'data'].includes(engineerFlavor)) return specialists;
  const replacement = {
    ai: 'cx-ai-engineer',
    platform: 'cx-platform-engineer',
    data: 'cx-data-engineer',
  }[engineerFlavor];
  const set = new Set(specialists);
  set.delete('cx-engineer');
  set.add(replacement);
  return [...set];
}

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

export function selectSpecialists({ request = '', intent, track, riskFlags = detectRiskFlags(request), workCategory = classifyWorkCategory(request, riskFlags) } = {}) {
  const text = String(request).toLowerCase();
  const productRequest = isProductIntelligenceRequest(text);
  const dataAnalysisRequest = isDataAnalysisRequest(text);
  const dataEngineeringRequest = isDataEngineeringRequest(text);
  if (track === EXECUTION_TRACKS.immediate) return [];
  if (track === EXECUTION_TRACKS.focused) {
    if (workCategory === WORK_CATEGORIES.visual || riskFlags.ui) return ['cx-designer'];
    if (productRequest) return ['cx-product-manager'];
    const docAuthoring = detectDocAuthoringIntent(text);
    if (docAuthoring?.owner) return [docAuthoring.owner];
    if (dataEngineeringRequest) return ['cx-data-engineer'];
    if (dataAnalysisRequest) return ['cx-data-analyst'];
    if (isLegalComplianceRequest(text)) return ['cx-legal-compliance'];
    if (isBusinessStrategyRequest(text)) return ['cx-business-strategist'];
    if (isOperationsPlanningRequest(text)) return ['cx-operations'];
    if (isRdLeadRequest(text)) return ['cx-rd-lead'];
    if (isExplorerRequest(text)) return ['cx-explorer'];
    if (riskFlags.docs) return ['cx-docs-keeper'];
    if (riskFlags.security && intent === INTENT_CLASSES.evaluation) return refineEngineeringSpecialists(['cx-security'], request);
    return refineEngineeringSpecialists(SPECIALIST_MAP[intent] || ['cx-engineer'], request);
  }

  const specialists = ['cx-architect'];
  if (intent === INTENT_CLASSES.fix || intent === INTENT_CLASSES.investigation) specialists.push('cx-debugger');
  if (intent === INTENT_CLASSES.research) specialists.push('cx-researcher');
  const docAuthoring = detectDocAuthoringIntent(text);
  if (docAuthoring?.owner) specialists.push(docAuthoring.owner);
  if (workCategory === WORK_CATEGORIES.visual || riskFlags.ui) specialists.push('cx-designer');
  if (productRequest) specialists.push('cx-product-manager');
  if (dataAnalysisRequest) specialists.push('cx-data-analyst');
  if (dataEngineeringRequest) specialists.push('cx-data-engineer');
  else if (riskFlags.docs) specialists.push('cx-docs-keeper');
  specialists.push('cx-engineer', 'cx-reviewer', 'cx-qa');
  if (riskFlags.security || riskFlags.dataIntegrity) specialists.push('cx-security');
  return refineEngineeringSpecialists(Array.from(new Set(specialists)), request);
}

export function augmentSpecialists(
  specialists = [],
  {
    request = '',
    docAuthoring = null,
    externalResearch = null,
    framingChallenge = null,
    artifactReview = null,
    triggers = [],
  } = {},
) {
  let list = [...specialists];
  if (docAuthoring?.owner && !list.includes(docAuthoring.owner)) {
    list = [docAuthoring.owner, ...list];
  }
  if (externalResearch?.required && !list.includes('cx-researcher')) {
    list = ['cx-researcher', ...list];
  }
  if (framingChallenge?.required && !list.includes('cx-devil-advocate')) {
    list = ['cx-devil-advocate', ...list];
  }
  for (const reviewer of artifactReview?.requiredReviewers || []) {
    if (!list.includes(reviewer)) list = [...list, reviewer];
  }
  if (isLegalComplianceRequest(request) && !list.includes('cx-legal-compliance')) {
    list = ['cx-legal-compliance', ...list];
  }
  if (isRdLeadRequest(request) && !list.includes('cx-rd-lead')) {
    list = ['cx-rd-lead', ...list];
  }
  if (isBusinessStrategyRequest(request) && !list.includes('cx-business-strategist')) {
    list = ['cx-business-strategist', ...list];
  }
  for (const { specialist } of triggers) {
    if (!list.includes(specialist)) list = [specialist, ...list];
  }
  return Array.from(new Set(list));
}

function enrichPolicyForProjectQuestion(request, policySpecialists = []) {
  if (!/\b(what is this (project|repo|codebase)|what('s| is) this (project|repo|codebase)|describe this (project|repo|codebase))\b/i.test(String(request))) {
    return policySpecialists;
  }
  const list = [...policySpecialists];
  if (!list.includes('cx-explorer')) list.unshift('cx-explorer');
  if (!list.includes('cx-researcher')) list.splice(list.indexOf('cx-explorer') + 1, 0, 'cx-researcher');
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
    parallelChecks.push('cx-security');
  }
  
  // Accessibility review can run parallel for UI work
  if (workCategory === WORK_CATEGORIES.visual || riskFlags.ui || containsAny(text, ['ui', 'ux', 'interface', 'component'])) {
    parallelChecks.push('cx-accessibility');
  }
  
  // Performance review for data-intensive operations
  if (containsAny(text, ['performance', 'latency', 'throughput', 'scale', 'optimization'])) {
    parallelChecks.push('cx-sre');
  }
  
  // Legal compliance for regulated domains
  if (isLegalComplianceRequest(request)) {
    parallelChecks.push('cx-legal-compliance');
  }
  
  return parallelChecks;
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
  };
}

// Signal-driven proactive triggers. Returns a list of { specialist, reason }
// pairs for specialists that should engage PRE-DISPATCH based on signals —
// separate from the keyword-only paths in selectSpecialists. The watch
// predicates and their specialist owners are declared in
// specialists/org (watchConditions) and evaluated by
// orchestration/routing-tables.mjs.

export function proactiveTriggers(signals) {
  return evaluateWatchConditions(signals).map(({ specialist, reason }) => ({ specialist, reason }));
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

function resolveArtifactReviewRequirements(docAuthoring) {
  if (!docAuthoring?.docType) {
    return { requiredReviewers: [], optionalReviewers: [], releaseGate: null };
  }
  const entry = getArtifactEntry(docAuthoring.docType);
  const gate = entry?.releaseGate ?? {};
  return {
    requiredReviewers: gate.requiredReviewers ?? [],
    optionalReviewers: gate.optionalReviewers ?? [],
    releaseGate: gate,
  };
}

// Map a free-text request to the decision names that gate it. Keyed against the
// union of every team's forbiddenDecisions so a BLOCKED status fires only when
// the request actually asks for a decision the primary team cannot make. Ordered
// most-specific-first (deployment-timing before deployment) so the narrow match
// wins.

const REQUESTED_DECISION_PATTERNS = [
  [/\bsecurity[ -]?override\b|\boverride\s+(the\s+)?security\b/i, 'security-override'],
  [/\bdeployment[ -]?timing\b|\bwhen\s+to\s+deploy\b|\bdeploy\s+(?:immediately|now)\b/i, 'deployment-timing'],
  [/\bdeployment[ -]?readiness\b/i, 'deployment-readiness'],
  [/\bdeploy(?:ment|ing|s)?\b|\brelease\s+to\s+prod/i, 'deployment'],
  [/\binfra(?:structure)?[ -]?change\b|\bchange\s+(?:the\s+)?infra/i, 'infra-change'],
  [/\bscope[ -]?change\b|\bchange\s+(?:the\s+)?scope\b|\bre-?scope\b/i, 'scope-change'],
  [/\bproduct[ -]?scope\b/i, 'product-scope'],
  [/\buser[ -]?research\s+method/i, 'user-research-methods'],
  [/\buser[ -]?research\b/i, 'user-research'],
  [/\bimplementation[ -]?approach\b/i, 'implementation-approach'],
  [/\bimplementation[ -]?detail/i, 'implementation-details'],
  [/\bsecurity[ -]?policy\b/i, 'security-policy'],
  [/\bops[ -]?procedure|operational\s+procedure/i, 'ops-procedures'],
  [/\barchitect/i, 'architecture'],
];

function detectRequestedDecisions(request = '') {
  const text = String(request || '');
  const found = new Set();
  for (const [pattern, decision] of REQUESTED_DECISION_PATTERNS) {
    if (pattern.test(text)) found.add(decision);
  }
  return Array.from(found);
}

/**
 * Build team-aware routing metadata (RFC-0004 §2).
 * Returns { primaryTeam, involvedTeams, requiredApprovals, escalationPath, blockedStatus }.
 *
 * The primary team is intent-driven (INTENT_TO_TEAM), falling back to the first
 * specialist's team when the intent has no mapping. involvedTeams unions the
 * primary team with every selected specialist's team. blockedStatus fires when
 * the primary team's forbiddenDecisions intersect the decisions the request asks
 * for; escalation walks the primary team's path first. Team membership and team
 * metadata resolve from specialists/org.
 */
export function teamRoutingForSpecialists(specialists = [], { intent = null, request = '', cwd = null, docAuthoring = null } = {}) {
  let registry = null;
  try {
    registry = loadRegistry();
  } catch {
    return {
      primaryTeam: null,
      involvedTeams: [],
      requiredApprovals: [],
      escalationPath: [],
      blockedStatus: null,
    };
  }

  const profile = cwd ? resolveActiveScope(cwd) : null;
  const profileTeams = scopeTeamsById(profile);

  const teams = new Map();
  const involvedTeamIds = new Set();
  const addTeam = (teamId) => {
    if (!teamId) return;
    involvedTeamIds.add(teamId);
    if (teams.has(teamId)) return;
    const profileTeam = profileTeams ? resolveScopeTeamMeta(teamId, profile) : null;
    teams.set(teamId, profileTeam || registry.teams?.[teamId] || null);
  };

  for (const specialistId of specialists) {
    const cxId = specialistId.startsWith('cx-') ? specialistId : `cx-${specialistId}`;
    const specialist = registry.specialists?.[cxId];
    if (specialist?.team) addTeam(specialist.team);
  }

  // RFC-0004 §2 step 2: intent selects the primary owning team. It always counts
  // as involved even if no selected specialist sits on it yet.
  const profileIntentTeam = resolveIntentTeamForScope(intent, profile);
  const intentTeam = profileIntentTeam
    ?? (intent && INTENT_TO_TEAM[intent] ? INTENT_TO_TEAM[intent] : null);
  addTeam(intentTeam);

  const involvedTeams = Array.from(involvedTeamIds).sort();
  let primaryTeam = intentTeam || (involvedTeams.length > 0 ? involvedTeams[0] : null);

  if (docAuthoring?.owner) {
    const cxId = docAuthoring.owner.startsWith('cx-') ? docAuthoring.owner : `cx-${docAuthoring.owner}`;
    const ownerTeam = registry.specialists?.[cxId]?.team;
    if (ownerTeam) {
      addTeam(ownerTeam);
      primaryTeam = ownerTeam;
    }
  }

  // Collect required approvals from involved teams' decision rights.
  const requiredApprovals = new Set();
  for (const teamId of involvedTeamIds) {
    const team = teams.get(teamId);
    if (team?.decisionRights) {
      for (const decision of team.decisionRights) requiredApprovals.add(decision);
    }
  }

  // RFC-0004 §2 step 5: BLOCKED when the primary team forbids a decision the
  // request actually asks for. Escalate via that team's path.
  let blockedStatus = null;
  const primaryTeamObj = primaryTeam ? (teams.get(primaryTeam) || registry.teams?.[primaryTeam]) : null;
  if (Array.isArray(primaryTeamObj?.forbiddenDecisions)) {
    const blocked = detectRequestedDecisions(request)
      .filter((decision) => primaryTeamObj.forbiddenDecisions.includes(decision));
    if (blocked.length > 0) {
      blockedStatus = {
        team: primaryTeam,
        forbiddenDecisions: blocked,
        escalationPath: primaryTeamObj.escalationPath || [],
      };
    }
  }

  // Concatenate escalation paths, primary team first, de-duplicated.
  const escalationPath = [];
  const seen = new Set();
  const orderedTeams = primaryTeam
    ? [primaryTeam, ...involvedTeams.filter((t) => t !== primaryTeam)]
    : involvedTeams;
  for (const teamId of orderedTeams) {
    const team = teams.get(teamId) || registry.teams?.[teamId];
    if (Array.isArray(team?.escalationPath)) {
      for (const role of team.escalationPath) {
        if (!seen.has(role)) {
          escalationPath.push(role);
          seen.add(role);
        }
      }
    }
  }

  const squadId = primaryTeamObj?.kind === 'squad' ? primaryTeam : null;
  const groupId = primaryTeamObj?.kind === 'group' ? primaryTeam : (primaryTeamObj?.groupId ?? null);

  return {
    primaryTeam,
    squadId,
    groupId,
    collaborators: primaryTeamObj?.collaborators || [],
    involvedTeams,
    requiredApprovals: Array.from(requiredApprovals).sort(),
    escalationPath,
    blockedStatus,
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
  for (const { specialist, reason } of triggers) {
    reasons[specialist] = reason;
  }

  const augmentOpts = {
    request: options.request,
    docAuthoring,
    externalResearch,
    framingChallenge,
    artifactReview,
    triggers,
  };

  let specialists = augmentSpecialists(
    selectSpecialists({ ...options, intent, track, riskFlags, workCategory }),
    augmentOpts,
  );

  const policyTrack = track === EXECUTION_TRACKS.immediate ? EXECUTION_TRACKS.focused : track;
  let policySpecialists = augmentSpecialists(
    selectSpecialists({ ...options, intent, track: policyTrack, riskFlags, workCategory }),
    augmentOpts,
  );
  policySpecialists = enrichPolicyForProjectQuestion(options.request, policySpecialists);

  const displaySpecialists = specialists.length ? specialists : policySpecialists;

  const contractChain = resolveContractChain({
    intent,
    workCategory,
    track,
    riskFlags,
    specialists: displaySpecialists,
    framingChallenge,
    externalResearch,
    docAuthoring,
    artifactReview,
  });

  // Team-aware routing: analyze specialist-to-team mapping and identify
  // team involvement, primary owner, required approvals, and escalation paths.
  const teamRouting = teamRoutingForSpecialists(displaySpecialists, {
    intent,
    request: options.request,
    cwd: options.cwd ?? null,
    docAuthoring,
  });

  const route = {
    intent,
    workCategory,
    track,
    riskFlags,
    productFlavor,
    roleFlavors,
    specialists,
    policySpecialists,
    displaySpecialists,
    signals,
    triggers,
    dispatchReasons: reasons,
    docAuthoring,
    externalResearch,
    framingChallenge,
    artifactReview,
    suggestedWorkflowType,
    researchExecutionPolicy,
    contractChain,
    teamRouting,
  };

  if (process.env.CONSTRUCT_VERBOSE === '1' && triggers.length > 0) {
    for (const { specialist, reason } of triggers) {
      console.error(`[route] proactive: ${specialist} (${reason})`);
    }
  }

  return route;
}

// Sync wrapper that returns the keyword route immediately and fires the
// LLM intent verifier in the background. The verifier writes its verdict
// to ~/.cx/intent-verifications.jsonl for offline tuning; the dispatched
// route never waits on a model round-trip. Disable the background call
// entirely with CONSTRUCT_INTENT_VERIFY=off — see lib/intent-classifier.mjs.
export function routeRequestVerified(options = {}) {
  const route = routeRequest(options);
  return verifyRoute(route, { request: options.request, modelCaller: options.modelCaller });
}

/**
 * Build the construct→orchestrator contract packet (specialists/org).
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
    : ['Dispatch plan emitted with specialists in sequence', 'Acceptance criteria verified before close'];

  return {
    goal,
    intent: route.intent,
    workCategory: route.workCategory,
    riskFlags: route.riskFlags || {},
    suggestedWorkflowType: route.suggestedWorkflowType || null,
    acceptanceCriteria,
  };
}
