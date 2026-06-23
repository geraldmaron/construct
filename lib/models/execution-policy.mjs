/**
 * lib/models/execution-policy.mjs — the immutable per-turn execution policy
 * compiler (construct-6zga.1.2).
 *
 * Compiles one frozen, traceable policy from an ExecutionCapabilityProfile
 * (construct-6zga.1.8) plus the turn's intent, task risk, and evidence
 * requirement. The policy is the single record the owned loop reads for prompt
 * section budgets, tool-schema and tool-group limits, tool-iteration caps, the
 * evidence-first requirement, output budget, visible-thinking policy, the
 * continuation/compaction trigger, and caching eligibility.
 *
 * Capability-driven, never name-driven: every control branches on the profile's
 * measured capability class, transport, and capability values plus the
 * normalized turn inputs — never on a provider or model-name string
 * (construct-6zga.1.2 AC4). A missing, unknown, or degraded profile collapses to
 * the conservative envelope and emits degraded-mode telemetry (AC3). The record
 * is frozen and JSON-serializable, and carries the profile key and turn inputs it
 * was derived from so a reader can re-verify it (AC1). Reference shape:
 * schemas/execution-policy.schema.json.
 */
import { MODEL_OPERATING_PROFILES } from '../model-router.mjs';
import { capabilityTierFromProfile, operatingProfileIdFromProfile } from './execution-capability-profile.mjs';

export const EXECUTION_POLICY_SCHEMA_VERSION = 1;

export const POLICY_INTENTS = Object.freeze([
  'repository-summary',
  'code-change',
  'research',
  'tool-failure',
  'general',
]);

export const POLICY_RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);

export const POLICY_EVIDENCE_REQUIREMENTS = Object.freeze(['none', 'preferred', 'required']);

export const POLICY_TOOL_GROUPS = Object.freeze(['read', 'search', 'edit', 'shell', 'construct', 'heavy-mcp']);

export const POLICY_THINKING_MODES = Object.freeze(['hidden', 'summary', 'full']);

const KNOWN_CAPABILITY_CLASSES = Object.freeze(new Set([
  'hosted-direct',
  'hosted-routed',
  'local-capable',
  'local-constrained',
  'unknown',
]));

// The capability class fixes the base execution envelope: how many tool schemas
// a model holds without overload, how many tool iterations it sustains
// coherently, how much output to budget, and whether visible reasoning helps or
// (for small local models that echo it back) hurts. Hosted-direct is the most
// capable; unknown is the most conservative. Turn intent and risk adjust these.

const CLASS_ENVELOPE = Object.freeze({
  'hosted-direct': Object.freeze({ toolTier: 'rich', maxToolIterations: 16, outputTokenBudget: 8000, visibleThinking: 'summary' }),
  'hosted-routed': Object.freeze({ toolTier: 'rich', maxToolIterations: 14, outputTokenBudget: 6000, visibleThinking: 'summary' }),
  'local-capable': Object.freeze({ toolTier: 'standard', maxToolIterations: 10, outputTokenBudget: 4000, visibleThinking: 'hidden' }),
  'local-constrained': Object.freeze({ toolTier: 'minimal', maxToolIterations: 6, outputTokenBudget: 2000, visibleThinking: 'hidden' }),
  unknown: Object.freeze({ toolTier: 'minimal', maxToolIterations: 4, outputTokenBudget: 1500, visibleThinking: 'hidden' }),
});

const TOOL_TIER_SCHEMA_CAP = Object.freeze({ rich: 32, standard: 16, minimal: 8 });

const TOOL_TIER_GROUPS = Object.freeze({
  rich: Object.freeze(['read', 'search', 'edit', 'shell', 'construct', 'heavy-mcp']),
  standard: Object.freeze(['read', 'search', 'edit', 'construct']),
  minimal: Object.freeze(['read', 'search', 'construct']),
});

const INTENT_EVIDENCE_FIRST = Object.freeze(new Set(['repository-summary', 'research', 'code-change']));
const INTENT_CITATIONS_REQUIRED = Object.freeze(new Set(['repository-summary', 'research']));

function clampInt(value, min, max) {
  const n = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, n));
}

function oneOf(allowed, value, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// The chat turn overlay (lib/chat/transparency.mjs) speaks the orchestration
// vocabulary (INTENT_CLASSES, risk flags, externalResearch). These helpers map it
// onto the compiler's stable input enums so the compiler stays decoupled from
// routing changes. A turn that follows a failed tool result is the recovery case
// the loop signals with toolFailure.

export function normalizePolicyIntent({ intent = null, assumptionsBlocked = false, toolFailure = false } = {}) {
  if (toolFailure === true) return 'tool-failure';
  const i = String(intent || '').toLowerCase();
  if (assumptionsBlocked === true && (i === '' || i === 'research' || i === 'investigation')) return 'repository-summary';
  if (i === 'investigation') return 'repository-summary';
  if (i === 'implementation' || i === 'fix') return 'code-change';
  if (i === 'research' || i === 'evaluation') return 'research';
  return 'general';
}

export function normalizePolicyRisk(riskFlags = {}) {
  const f = riskFlags && typeof riskFlags === 'object' ? riskFlags : {};
  if (f.security === true || f.dataIntegrity === true) return 'high';
  if (f.architecture === true || f.ai === true) return 'medium';
  return 'low';
}

export function normalizeEvidenceRequirement({ externalResearch = null, assumptionsBlocked = false } = {}) {
  if (externalResearch?.required === true || assumptionsBlocked === true) return 'required';
  return 'none';
}

/**
 * Compile the immutable per-turn execution policy. Branches only on the profile's
 * capability class, transport, and capability values plus the normalized intent,
 * risk, and evidence requirement — never on a model or provider name (AC4).
 */
export function compileExecutionPolicy({
  profile = null,
  intent = 'general',
  risk = 'low',
  evidenceRequirement = 'none',
} = {}) {
  const safeProfile = profile && typeof profile === 'object' ? profile : null;
  const capabilityClass = KNOWN_CAPABILITY_CLASSES.has(safeProfile?.capabilityClass)
    ? safeProfile.capabilityClass
    : 'unknown';
  const transport = typeof safeProfile?.transport === 'string' ? safeProfile.transport : 'unknown';

  const normIntent = oneOf(POLICY_INTENTS, intent, 'general');
  const normRisk = oneOf(POLICY_RISK_LEVELS, risk, 'low');
  const normEvidence = oneOf(POLICY_EVIDENCE_REQUIREMENTS, evidenceRequirement, 'none');

  const degradeReasons = [];
  if (!safeProfile) degradeReasons.push('profile-missing');
  if (capabilityClass === 'unknown') degradeReasons.push('capability-class-unknown');
  if (safeProfile?.degraded === true) degradeReasons.push('profile-degraded');
  const degraded = degradeReasons.length > 0;

  const envelope = CLASS_ENVELOPE[capabilityClass];

  // A degraded or unmeasured record must not unlock rich tool budgets, so it
  // collapses to the minimal tier regardless of its nominal class.

  const effectiveToolTier = degraded ? 'minimal' : envelope.toolTier;

  let maxToolSchemas = TOOL_TIER_SCHEMA_CAP[effectiveToolTier];
  let maxToolIterations = envelope.maxToolIterations;
  if (normIntent === 'code-change') maxToolIterations += 4;
  else if (normIntent === 'research') maxToolIterations += 2;
  else if (normIntent === 'tool-failure') {
    maxToolIterations = clampInt(maxToolIterations / 2, 2, maxToolIterations);
    maxToolSchemas = Math.min(maxToolSchemas, 6);
  }

  const groups = new Set(TOOL_TIER_GROUPS[effectiveToolTier]);
  if (normIntent === 'repository-summary' || normIntent === 'research') {
    groups.delete('edit');
    groups.delete('shell');
  }
  if (normIntent === 'tool-failure') groups.delete('heavy-mcp');
  const allowedToolGroups = POLICY_TOOL_GROUPS.filter((g) => groups.has(g));

  const evidenceFirst = degraded
    || normRisk === 'high'
    || normEvidence !== 'none'
    || INTENT_EVIDENCE_FIRST.has(normIntent);
  const citationsRequired = normEvidence === 'required'
    || normRisk === 'high'
    || INTENT_CITATIONS_REQUIRED.has(normIntent);

  let visibleThinking = degraded ? 'hidden' : envelope.visibleThinking;
  if (!degraded && normRisk === 'high' && visibleThinking === 'hidden') visibleThinking = 'summary';

  const cacheCapable = safeProfile?.capabilities?.cacheControl?.value === true;
  const cachingEligible = cacheCapable && !degraded;

  const contextWindow = Number(safeProfile?.capabilities?.contextWindow?.value);
  const hasContextWindow = Number.isFinite(contextWindow) && contextWindow > 0;
  const compactionTriggerRatio = degraded ? 0.5 : 0.75;
  const compactionTriggerTokens = hasContextWindow ? Math.floor(contextWindow * compactionTriggerRatio) : null;

  const resolvedOperatingProfileId = operatingProfileIdFromProfile(safeProfile);
  const operatingProfileId = MODEL_OPERATING_PROFILES[resolvedOperatingProfileId] ? resolvedOperatingProfileId : 'balanced';
  const op = MODEL_OPERATING_PROFILES[operatingProfileId];

  const policy = {
    schemaVersion: EXECUTION_POLICY_SCHEMA_VERSION,
    source: Object.freeze({
      profileSchemaVersion: safeProfile?.schemaVersion ?? null,
      profileKey: safeProfile?.key ? Object.freeze({ ...safeProfile.key }) : null,
      capabilityClass,
      transport,
      intent: normIntent,
      risk: normRisk,
      evidenceRequirement: normEvidence,
      evidenceSources: Object.freeze([...(Array.isArray(safeProfile?.evidenceSources) ? safeProfile.evidenceSources : [])]),
    }),
    prompt: Object.freeze({
      systemPromptTier: capabilityTierFromProfile(safeProfile),
      operatingProfileId,
      sectionBudgets: Object.freeze({
        maxPromptTokens: op.maxPromptTokens,
        learnedPatternsTokens: op.learnedPatternsTokens,
        taskPacketTokens: op.taskPacketTokens,
        contextDigestTokens: op.contextDigestTokens,
        hostConstraintsTokens: op.hostConstraintsTokens,
        roleFlavorTokens: op.roleFlavorTokens,
      }),
      retrievalFirst: op.retrievalFirst === true,
      preferCompressedGuidance: op.preferCompressedRoleGuidance === true,
    }),
    tools: Object.freeze({
      maxToolSchemas,
      allowedToolGroups: Object.freeze(allowedToolGroups),
      maxToolIterations,
    }),
    evidence: Object.freeze({
      evidenceFirst,
      citationsRequired,
    }),
    output: Object.freeze({
      outputTokenBudget: envelope.outputTokenBudget,
      visibleThinking,
    }),
    continuation: Object.freeze({
      compactionTriggerRatio,
      compactionTriggerTokens,
    }),
    caching: Object.freeze({
      eligible: cachingEligible,
      scope: cachingEligible ? 'stable-prefix' : 'none',
    }),
    degradedMode: degraded,
    telemetry: Object.freeze({
      degraded,
      reasons: Object.freeze(degradeReasons),
    }),
  };
  return Object.freeze(policy);
}

/**
 * Compile a policy directly from a chat turn overlay (lib/chat/transparency.mjs),
 * normalizing its routing vocabulary into the compiler's input enums first.
 */
export function compilePolicyFromOverlay({ profile = null, overlay = null, toolFailure = false } = {}) {
  const intent = normalizePolicyIntent({
    intent: overlay?.intent,
    assumptionsBlocked: overlay?.assumptionsBlocked === true,
    toolFailure,
  });
  const risk = normalizePolicyRisk(overlay?.riskFlags);
  const evidenceRequirement = normalizeEvidenceRequirement({
    externalResearch: overlay?.externalResearch,
    assumptionsBlocked: overlay?.assumptionsBlocked === true,
  });
  return compileExecutionPolicy({ profile, intent, risk, evidenceRequirement });
}

/**
 * Hand-rolled validator (no ajv — Construct stays dependency-free at startup).
 * Returns { valid, errors } against schemas/execution-policy.schema.json.
 */
export function validateExecutionPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') return { valid: false, errors: ['policy is not an object'] };
  if (policy.schemaVersion !== EXECUTION_POLICY_SCHEMA_VERSION) errors.push(`schemaVersion must be ${EXECUTION_POLICY_SCHEMA_VERSION}`);

  const s = policy.source;
  if (!s || typeof s !== 'object') errors.push('source missing');
  else {
    if (!KNOWN_CAPABILITY_CLASSES.has(s.capabilityClass)) errors.push(`source.capabilityClass invalid: ${s.capabilityClass}`);
    if (!POLICY_INTENTS.includes(s.intent)) errors.push(`source.intent invalid: ${s.intent}`);
    if (!POLICY_RISK_LEVELS.includes(s.risk)) errors.push(`source.risk invalid: ${s.risk}`);
    if (!POLICY_EVIDENCE_REQUIREMENTS.includes(s.evidenceRequirement)) errors.push(`source.evidenceRequirement invalid: ${s.evidenceRequirement}`);
  }

  const t = policy.tools;
  if (!t || typeof t !== 'object') errors.push('tools missing');
  else {
    if (!Number.isInteger(t.maxToolSchemas) || t.maxToolSchemas < 0) errors.push('tools.maxToolSchemas invalid');
    if (!Number.isInteger(t.maxToolIterations) || t.maxToolIterations < 1) errors.push('tools.maxToolIterations invalid');
    if (!Array.isArray(t.allowedToolGroups) || t.allowedToolGroups.some((g) => !POLICY_TOOL_GROUPS.includes(g))) errors.push('tools.allowedToolGroups invalid');
  }

  const o = policy.output;
  if (!o || typeof o !== 'object') errors.push('output missing');
  else {
    if (!Number.isInteger(o.outputTokenBudget) || o.outputTokenBudget < 1) errors.push('output.outputTokenBudget invalid');
    if (!POLICY_THINKING_MODES.includes(o.visibleThinking)) errors.push(`output.visibleThinking invalid: ${o.visibleThinking}`);
  }

  const e = policy.evidence;
  if (!e || typeof e !== 'object') errors.push('evidence missing');
  else {
    if (typeof e.evidenceFirst !== 'boolean') errors.push('evidence.evidenceFirst must be boolean');
    if (typeof e.citationsRequired !== 'boolean') errors.push('evidence.citationsRequired must be boolean');
  }

  if (!policy.caching || typeof policy.caching !== 'object') errors.push('caching missing');
  else if (typeof policy.caching.eligible !== 'boolean') errors.push('caching.eligible must be boolean');

  if (typeof policy.degradedMode !== 'boolean') errors.push('degradedMode must be boolean');
  if (!policy.telemetry || typeof policy.telemetry !== 'object' || typeof policy.telemetry.degraded !== 'boolean') errors.push('telemetry.degraded must be boolean');

  return { valid: errors.length === 0, errors };
}
