/**
 * lib/orchestration/classification.mjs — text classifiers for orchestration
 * routing policy: intent, work category, risk flags, execution track, role
 * flavor overlays, doc-authoring detection, named-entity/research-shape/live-
 * web-access signals.
 *
 * Extracted from lib/orchestration-policy.mjs (construct-rf26.10). Every
 * function here is a pure classifier over request text (or over another
 * classifier's output) — no gate evaluation (requires*) and no
 * specialist/flow selection lives in this module. orchestration-policy.mjs
 * re-exports these unchanged for existing callers.
 */
import { ownerForDoc } from './routing-tables.mjs';
import { formatOverlayLine } from '../roles/flavor-bindings.mjs';
import { EXECUTION_TRACKS, WORK_CATEGORIES, INTENT_CLASSES } from './policy-constants.mjs';
import { routingTriggerFires, extraRiskFlags, matchRoutingTriggers } from './routing-triggers.mjs';

export function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function containsAny(text, words) {
  return words.some((word) => text.includes(word));
}

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

// The docType each pattern maps to must exist in the routing registry's
// knownDocTypes(), or detectDocAuthoringIntent returns a docType with a null
// owner and the request silently loses its canonical author. A drift-guard test
// (tests/orchestration-doc-authoring-patterns.test.mjs) asserts the subset,
// since the mapping cannot be generated from the registry (the regex is
// natural-language, only the docType string is registry-owned) — construct-v1wk.

export function docAuthoringDocTypes() {
  return DOC_AUTHORING_PATTERNS.map(({ docType }) => docType);
}

const AUTHORING_VERBS = /\b(write|writing|draft|drafting|create|creating|author|authoring|produce|producing|compose|composing|prepare|preparing|generate|generating|synthesize|synthesizing|synthesis|compile|compiling)\b/i;

const PRD_PLATFORM_SUBTYPE_SIGNALS = /\b(control[\s-]plane|\bapi\b|\bsdk\b|\btenant\b)\b/i;
const PRD_BUSINESS_SUBTYPE_SIGNALS = /\b(pricing|packaging|billing model)\b/i;

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
 * Refines a generic `prd` docType using high-confidence semantic subtype signals.
 */
export function refineDocAuthoringSubtype(docType, request = '') {
  if (docType !== 'prd') return docType;
  const text = String(request);
  if (PRD_BUSINESS_SUBTYPE_SIGNALS.test(text)) return 'prd-business';
  if (PRD_PLATFORM_SUBTYPE_SIGNALS.test(text)) return 'prd-platform';
  return docType;
}

function collectDocAuthoringMatches(request = '') {
  const text = String(request);
  const items = [];
  const seen = new Set();
  for (const { pattern, docType } of DOC_AUTHORING_PATTERNS) {
    if (!pattern.test(text)) continue;
    const refined = refineDocAuthoringSubtype(docType, text);
    if (seen.has(refined)) continue;
    seen.add(refined);
    items.push({ docType: refined, owner: ownerForDoc(refined) });
  }
  return items;
}

/**
 * Detects every typed document the request asks to author when an authoring
 * verb is present. Each item is `{ docType, owner }`.
 */
export function detectDocAuthoringItems(request = '') {
  const text = String(request);
  if (!AUTHORING_VERBS.test(text)) return [];
  return collectDocAuthoringMatches(text);
}

/**
 * Detects whether the request is asking for authorship of a typed document
 * that has a canonical owner. Returns `{ docType, owner }` when matched,
 * or null otherwise. For multi-type requests, returns the first match for
 * backward compatibility; use detectDocAuthoringItems for the full list.
 */
export function detectDocAuthoringIntent(request = '') {
  return detectDocAuthoringItems(request)[0] ?? null;
}

const PROPER_NOUN_STOPLIST = new Set([
  'I', 'A', 'An', 'The', 'This', 'That', 'These', 'Those', 'My', 'Our', 'Your',
  'We', 'They', 'He', 'She', 'It', 'Please', 'Thanks', 'Hi', 'Hello',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Construct', 'Claude', 'GPT', 'OpenAI', 'Anthropic', 'GitHub', 'Google', 'Microsoft',
]);

// Common stack nouns that appear capitalized mid-sentence ("a Node.js Express API with Jest").
// They must not force external research or steal the lead from engineer/architect on
// implementation asks. Product/company entities (Temporal, Datadog) still fire the gate.
const TECH_STACK_ENTITY_STOPLIST = new Set([
  'Node', 'Nodejs', 'JavaScript', 'TypeScript', 'Python', 'Java', 'Kotlin', 'Swift', 'Rust', 'Go', 'Golang',
  'React', 'Vue', 'Angular', 'Svelte', 'Next', 'Nextjs', 'Express', 'Fastify', 'Nest', 'Django', 'Flask', 'Rails',
  'Jest', 'Vitest', 'Mocha', 'Cypress', 'Playwright', 'Pytest',
  'Postgres', 'PostgreSQL', 'Mysql', 'Mongo', 'MongoDB', 'Redis', 'Sqlite', 'Dynamo', 'DynamoDB',
  'Docker', 'Kubernetes', 'K8s', 'Terraform', 'Ansible',
  'Aws', 'GCP', 'Azure', 'Lambda', 'S3', 'Ec2',
  'Graphql', 'Grpc', 'Rest', 'Http', 'Https', 'Json', 'Yaml', 'Toml',
  'Webpack', 'Vite', 'Esbuild', 'Npm', 'Pnpm', 'Yarn', 'Bun',
  'Linux', 'Unix', 'Macos', 'Windows', 'Ios', 'Android',
  'Api', 'Sdk', 'Cli', 'Ui', 'Ux', 'Ci', 'Cd', 'Cdn', 'Dns', 'Tls', 'Ssl', 'Oauth', 'Oidc', 'Jwt',
  'Worker', 'Profile', 'Engineer', 'Architect', 'Researcher', 'Reviewer', 'Designer', 'Debugger',
  'Operations', 'Security', 'Orchestrator',
]);

function normalizeEntityToken(token = '') {
  return String(token).replace(/\.js$/i, '').replace(/[^A-Za-z0-9]+/g, '');
}

export function isTechStackEntity(token = '') {
  const raw = String(token || '').trim();
  if (!raw) return false;
  const parts = raw.split(/\s+/);
  return parts.every((part) => TECH_STACK_ENTITY_STOPLIST.has(normalizeEntityToken(part)));
}

/**
 * Extracts proper-noun candidates from a request: capitalized tokens that are
 * not common English words, day/month names, known product/company names, or
 * common tech-stack nouns. Detects named entities that likely need external research.
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
    if (PROPER_NOUN_STOPLIST.has(head)) return false;
    if (isTechStackEntity(token)) return false;
    return true;
  });
}

const WORKER_PROFILE_NAME =
  '(architect|engineer|researcher|reviewer|debugger|designer|operations|security|product-manager|product\\s+manager|data-analyst|data\\s+analyst|qa|orchestrator)';

const EXPLICIT_WORKER_PROFILE_RE = new RegExp(
  String.raw`\b(?:as\s+(?:the\s+|an?\s+)?|you\s+are\s+(?:the\s+|an?\s+)?|(?:use|run|assign)\s+(?:the\s+)?)` +
    WORKER_PROFILE_NAME +
    String.raw`(?:\s+worker\s+profile|\s+profile)?\b|` +
    String.raw`\b` + WORKER_PROFILE_NAME + String.raw`\s+(?:worker\s+)?profile\b`,
  'i',
);

function normalizeWorkerProfileName(raw = '') {
  return String(raw || '').toLowerCase().replace(/\s+/g, '-');
}

/**
 * When the user names a Worker Profile explicitly, honor that as the primary
 * assignment instead of letting research/augmentation steal the lead.
 */
export function detectExplicitWorkerProfile(request = '') {
  const match = EXPLICIT_WORKER_PROFILE_RE.exec(String(request || ''));
  if (!match) return null;
  return normalizeWorkerProfileName(match[1] || match[2]);
}

/**
 * Detect ordered team chains like "architect then engineer then reviewer".
 * Returns profile ids in stated order when at least two roles are chained.
 */
export function detectTeamChain(request = '') {
  const text = String(request || '');
  const chainRe = new RegExp(
    String.raw`\b${WORKER_PROFILE_NAME}\b(?:\s*(?:,|then|->|→|/)\s*\b${WORKER_PROFILE_NAME}\b)+`,
    'gi',
  );
  const hit = chainRe.exec(text);
  if (!hit) return [];
  const names = hit[0].match(new RegExp(WORKER_PROFILE_NAME, 'gi')) || [];
  return Array.from(new Set(names.map(normalizeWorkerProfileName)));
}

// Research-shaped intent is the vocabulary of external and landscape research —
// where the answer lives in papers, vendor docs, standards, or the market, not
// in the local code. Grouped by shape so the matched kind rides on the gate
// result and the decision is traceable. A false positive here is cheap (it only
// offers the researcher specialist, with no routing latency and no heavy-flow
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
// the web-capable researcher. A literal URL, an explicit online/internet
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
 * must be routed to researcher rather than answered immediately.
 */
export function requiresLiveWebAccess(request = '') {
  const text = String(request);
  return LIVE_WEB_ACCESS_PATTERNS.some((pattern) => pattern.test(text));
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

// Keyword list moved to registry/routing-triggers.json (id: "legal-compliance",
// construct-uizpv.4) — legal-compliance is a data-declared trigger record, not
// a hardcoded special case. This wrapper stays for callers that need a single
// boolean.
export function isLegalComplianceRequest(request = '') {
  return routingTriggerFires('legal-compliance', request);
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
// overlay". Verbose host surfaces + construct_trace span attribute; lets a
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

// The fixed enum below stays for backward-compatible field names every
// consumer already reads (riskFlags.security, riskFlags.ui, ...). Personas
// extend the enum without a lib/ edit via registry/routing-triggers.json's
// riskFlagDimensions (or a .construct/orchestration/routing-triggers.json
// project overlay) — those keys are merged in additively.
export function detectRiskFlags(request = '') {
  const text = String(request).toLowerCase();
  return {
    architecture: containsAny(text, ['architecture', 'interface contract', 'api contract', 'dependency', 'module boundary', 'data model', 'indexing', 'retrieval design', 'terraform', 'infrastructure', 'iac', 'provisioning', 'blast radius', 'rollout', 'deployment strategy']),
    security: containsAny(text, ['security', 'permission', 'secret', 'privacy', 'payment', 'authentication', 'authorization', 'credential', 'oidc', 'iam', 'access token']),
    dataIntegrity: containsAny(text, ['migration', 'data', 'sync', 'consistency', 'state', 'tfstate', 'drift']),
    ui: containsAny(text, ['ui', 'ux', 'design system', 'screen', 'layout', 'visual', 'onboarding']) && !containsAny(text, ['requirements']),
    docs: containsAny(text, ['docs', 'readme', 'runbook', 'adr']),
    ai: containsAny(text, ['llm', ' agent', 'prompt', 'rag', 'model behavior', 'retrieval', 'embedding', 'vector']),
    ...extraRiskFlags(request),
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
    matchRoutingTriggers(request, { riskFlags }).length > 0
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
