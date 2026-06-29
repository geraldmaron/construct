/**
 * tests/execution-policy.test.mjs — capability-adaptive execution policy compiler
 * (construct-6zga.1.2).
 *
 * Proves the policy is immutable, traceable, and profile-driven (AC1); the four
 * named turn intents meet quality/evidence budgets across every capability class
 * (AC2); unknown/missing/degraded profiles compile to the conservative envelope
 * with degraded-mode telemetry (AC3); and no provider/model-name conditional
 * exists in the compiler — identical capability records yield identical policies
 * regardless of model name (AC4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXECUTION_POLICY_SCHEMA_VERSION,
  compileExecutionPolicy,
  compilePolicyFromRoutingOverlay,
  validateExecutionPolicy,
  normalizePolicyIntent,
  normalizePolicyRisk,
  normalizeEvidenceRequirement,
} from '../lib/models/execution-policy.mjs';
import { resolveExecutionCapabilityProfile, capabilityTierFromProfile } from '../lib/models/execution-capability-profile.mjs';
import { CAPABILITY_CLASSES } from '../lib/models/behavior-matrix.mjs';

const NOW = () => '2026-06-21T00:00:00.000Z';
const MODELS = [
  'anthropic/claude-opus-4-6',
  'openai/gpt-5.1',
  'openrouter/qwen/qwen3-coder:free',
  'ollama/llama3.1:8b',
  'ollama/devstral:24b',
  'local/custom-large',
  'github-copilot/gpt-5.5',
  'mystery/x',
];
const NAMED_INTENTS = ['repository-summary', 'code-change', 'research', 'tool-failure'];

function profileForClass(capabilityClass, capabilityOverrides = {}) {
  return Object.freeze({
    schemaVersion: 1,
    key: Object.freeze({ provider: 'x', requestedModel: 'x/y', resolvedModel: 'x/y', adapterProtocol: 'p', observedAt: NOW() }),
    capabilityClass,
    transport: 'direct',
    capabilities: Object.freeze({
      contextWindow: Object.freeze({ value: 200000, source: 'provider_metadata', confidence: 'medium' }),
      cacheControl: Object.freeze({ value: capabilityClass === 'hosted-direct', source: 'provider_metadata', confidence: 'medium' }),
      capabilityTier: Object.freeze({ value: 'full', source: 'compatibility_fallback', confidence: 'low' }),
      operatingProfileId: Object.freeze({ value: 'balanced', source: 'compatibility_fallback', confidence: 'low' }),
      ...capabilityOverrides,
    }),
    degraded: capabilityClass === 'unknown',
    evidenceSources: Object.freeze(['provider_metadata']),
  });
}

test('AC1: policy is frozen, schema-valid, and traces its profile source', () => {
  const profile = resolveExecutionCapabilityProfile({ model: 'anthropic/claude-opus-4-6', now: NOW });
  const policy = compileExecutionPolicy({ profile, intent: 'code-change', risk: 'low' });
  const { valid, errors } = validateExecutionPolicy(policy);
  assert.ok(valid, errors.join('; '));
  assert.equal(policy.schemaVersion, EXECUTION_POLICY_SCHEMA_VERSION);
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.tools));
  assert.ok(Object.isFrozen(policy.prompt.sectionBudgets));
  assert.equal(policy.source.intent, 'code-change');
  assert.equal(policy.source.capabilityClass, profile.capabilityClass);
  assert.equal(policy.source.profileKey.requestedModel, 'anthropic/claude-opus-4-6');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(policy)));
});

test('AC1: prompt section budgets are profile-driven from the operating profile', () => {
  const balanced = compileExecutionPolicy({ profile: profileForClass('hosted-direct') });
  assert.equal(balanced.prompt.operatingProfileId, 'balanced');
  assert.equal(balanced.prompt.sectionBudgets.maxPromptTokens, 3000);
  const small = compileExecutionPolicy({
    profile: profileForClass('local-capable', {
      operatingProfileId: Object.freeze({ value: 'small', source: 'compatibility_fallback', confidence: 'low' }),
    }),
  });
  assert.equal(small.prompt.operatingProfileId, 'small');
  assert.equal(small.prompt.sectionBudgets.maxPromptTokens, 1800);
  assert.equal(small.prompt.preferCompressedGuidance, true);
});

test('AC2: every named intent meets quality/evidence budgets for every capability class', () => {
  for (const capabilityClass of CAPABILITY_CLASSES) {
    const profile = profileForClass(capabilityClass);
    for (const intent of NAMED_INTENTS) {
      const policy = compileExecutionPolicy({ profile, intent, risk: 'low' });
      assert.ok(validateExecutionPolicy(policy).valid, `${capabilityClass}/${intent} invalid`);
      assert.ok(policy.tools.maxToolSchemas >= 1, `${capabilityClass}/${intent} schemas`);
      assert.ok(policy.tools.maxToolIterations >= 2, `${capabilityClass}/${intent} iterations`);
      assert.ok(policy.output.outputTokenBudget >= 1, `${capabilityClass}/${intent} output`);

      if (intent === 'repository-summary' || intent === 'research') {
        assert.equal(policy.evidence.evidenceFirst, true, `${capabilityClass}/${intent} evidenceFirst`);
        assert.equal(policy.evidence.citationsRequired, true, `${capabilityClass}/${intent} citations`);
        assert.ok(!policy.tools.allowedToolGroups.includes('edit'), `${capabilityClass}/${intent} excludes edit`);
      }
      if (intent === 'tool-failure') {
        assert.ok(policy.tools.maxToolSchemas <= 6, `${capabilityClass} tool-failure trims schema overload`);
        assert.ok(!policy.tools.allowedToolGroups.includes('heavy-mcp'), `${capabilityClass} tool-failure drops heavy mcp`);
      }
    }
  }
});

test('AC2: a capable hosted class grants richer budgets than a constrained local class', () => {
  const hosted = compileExecutionPolicy({ profile: profileForClass('hosted-direct'), intent: 'code-change' });
  const local = compileExecutionPolicy({ profile: profileForClass('local-constrained'), intent: 'code-change' });
  assert.ok(hosted.tools.maxToolSchemas > local.tools.maxToolSchemas);
  assert.ok(hosted.tools.maxToolIterations > local.tools.maxToolIterations);
  assert.ok(hosted.output.outputTokenBudget > local.output.outputTokenBudget);
  assert.equal(hosted.caching.eligible, true);
  assert.equal(local.caching.eligible, false);
});

test('AC3: unknown, missing, and degraded profiles use the conservative envelope with degraded telemetry', () => {
  const unknown = compileExecutionPolicy({ profile: profileForClass('unknown'), intent: 'general' });
  assert.equal(unknown.degradedMode, true);
  assert.equal(unknown.telemetry.degraded, true);
  assert.ok(unknown.telemetry.reasons.includes('capability-class-unknown'));
  assert.equal(unknown.caching.eligible, false);
  assert.equal(unknown.output.visibleThinking, 'hidden');
  assert.equal(unknown.tools.maxToolSchemas, 8);

  const missing = compileExecutionPolicy({ profile: null });
  assert.equal(missing.degradedMode, true);
  assert.ok(missing.telemetry.reasons.includes('profile-missing'));
  assert.equal(validateExecutionPolicy(missing).valid, true);

  const degradedHosted = {
    ...profileForClass('hosted-direct', { cacheControl: Object.freeze({ value: true, source: 'compatibility_fallback', confidence: 'low' }) }),
    degraded: true,
  };
  const dp = compileExecutionPolicy({ profile: degradedHosted });
  assert.ok(dp.telemetry.reasons.includes('profile-degraded'));
  assert.equal(dp.tools.maxToolSchemas, 8);
  assert.equal(dp.caching.eligible, false);
  assert.equal(dp.continuation.compactionTriggerRatio, 0.5);
});

test('AC4: identical capability records compile to identical policies regardless of model name', () => {
  const base = profileForClass('hosted-direct');
  const renamed = Object.freeze({
    ...base,
    key: Object.freeze({ provider: 'totally-different', requestedModel: 'evil/cheat-9000', resolvedModel: 'evil/cheat-9000', adapterProtocol: 'p', observedAt: NOW() }),
  });
  const a = compileExecutionPolicy({ profile: base, intent: 'code-change', risk: 'medium' });
  const b = compileExecutionPolicy({ profile: renamed, intent: 'code-change', risk: 'medium' });
  const stripKey = (p) => { const j = JSON.parse(JSON.stringify(p)); j.source.profileKey = null; return j; };
  assert.deepEqual(stripKey(a), stripKey(b));
});

test('high risk forces evidence-first, citations, and visible reasoning', () => {
  const low = compileExecutionPolicy({ profile: profileForClass('hosted-direct'), intent: 'general', risk: 'low' });
  const high = compileExecutionPolicy({ profile: profileForClass('hosted-direct'), intent: 'general', risk: 'high' });
  assert.equal(low.evidence.evidenceFirst, false);
  assert.equal(high.evidence.evidenceFirst, true);
  assert.equal(high.evidence.citationsRequired, true);
  assert.notEqual(high.output.visibleThinking, 'hidden');
});

test('the compiled system-prompt tier equals the legacy capability tier for every model', () => {
  for (const model of MODELS) {
    const profile = resolveExecutionCapabilityProfile({ model, now: NOW });
    const policy = compileExecutionPolicy({ profile });
    assert.equal(policy.prompt.systemPromptTier, capabilityTierFromProfile(profile), `tier mismatch for ${model}`);
  }
});

test('overlay normalization maps routing vocabulary onto policy inputs', () => {
  assert.equal(normalizePolicyIntent({ intent: 'implementation' }), 'code-change');
  assert.equal(normalizePolicyIntent({ intent: 'fix' }), 'code-change');
  assert.equal(normalizePolicyIntent({ intent: 'research' }), 'research');
  assert.equal(normalizePolicyIntent({ intent: 'investigation' }), 'repository-summary');
  assert.equal(normalizePolicyIntent({ assumptionsBlocked: true }), 'repository-summary');
  assert.equal(normalizePolicyIntent({ toolFailure: true, intent: 'implementation' }), 'tool-failure');
  assert.equal(normalizePolicyRisk({ security: true }), 'high');
  assert.equal(normalizePolicyRisk({ architecture: true }), 'medium');
  assert.equal(normalizePolicyRisk({}), 'low');
  assert.equal(normalizeEvidenceRequirement({ externalResearch: { required: true } }), 'required');
  assert.equal(normalizeEvidenceRequirement({}), 'none');
});

test('compilePolicyFromRoutingOverlay threads a routing overlay through to a valid policy', () => {
  const profile = resolveExecutionCapabilityProfile({ model: 'anthropic/claude-opus-4-6', now: NOW });
  const overlay = { intent: 'fix', riskFlags: { security: true }, externalResearch: { required: true }, assumptionsBlocked: false };
  const policy = compilePolicyFromRoutingOverlay({ profile, overlay });
  assert.equal(policy.source.intent, 'code-change');
  assert.equal(policy.source.risk, 'high');
  assert.equal(policy.source.evidenceRequirement, 'required');
  assert.equal(policy.evidence.evidenceFirst, true);
  assert.ok(validateExecutionPolicy(policy).valid);
});

test('validateExecutionPolicy rejects malformed records', () => {
  assert.equal(validateExecutionPolicy(null).valid, false);
  assert.equal(validateExecutionPolicy({ schemaVersion: 999 }).valid, false);
});
