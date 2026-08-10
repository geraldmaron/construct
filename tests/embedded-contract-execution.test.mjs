/**
 * tests/embedded-contract-execution.test.mjs — execution-capability contract.
 *
 * Drives resolveExecution through every decision-table row: orchestrated on a
 * recognized host model, same-family fallback (degraded), prompt-only-by-request,
 * orchestrated requested but unresolvable (degraded prompt-only), host-direct,
 * and an unknown Procedure. Pins the mandatory `semantics` disclaimer, that
 * constructCapabilitiesActive is a subset of the declared set, and that a
 * credential canary in env never reaches the response — the no-fabrication and
 * no-secret guarantees.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveExecution,
  EXECUTION_MODES,
  CONSTRUCT_STRATEGIES,
  CONSTRUCT_CAPABILITIES,
  EXECUTION_SEMANTICS,
} from '../lib/embedded-contract/execution.mjs';

const ANTHROPIC_MODEL = 'anthropic/claude-sonnet-4-6';

function baseEnv(extra = {}) {
  return { CONSTRUCT_MODEL_REASONING: ANTHROPIC_MODEL, CONSTRUCT_MODEL_STANDARD: ANTHROPIC_MODEL, CONSTRUCT_MODEL_FAST: ANTHROPIC_MODEL, ...extra };
}

function assertCommonShape(r) {
  assert.ok(EXECUTION_MODES.includes(r.executionMode), `executionMode ${r.executionMode} is in the enum`);
  assert.equal(r.semantics, EXECUTION_SEMANTICS, 'mandatory semantics disclaimer present');
  for (const cap of r.constructCapabilitiesActive) {
    assert.ok(CONSTRUCT_CAPABILITIES.includes(cap), `${cap} is a declared capability`);
  }
  assert.ok(Array.isArray(r.warnings));
}

test('exports declare the enums', () => {
  assert.deepEqual(CONSTRUCT_STRATEGIES, ['orchestrated', 'prompt-only', 'auto']);
  assert.ok(CONSTRUCT_CAPABILITIES.includes('prompt-envelope'));
});

test('orchestrated on a recognized host model → construct-orchestrated, not degraded', () => {
  const r = resolveExecution(
    { procedureId: 'architecture-review', requestedStrategy: 'orchestrated', hostModel: ANTHROPIC_MODEL },
    { env: baseEnv() },
  );
  assertCommonShape(r);
  assert.equal(r.executionMode, 'construct-orchestrated');
  assert.equal(r.effectiveStrategy, 'orchestrated');
  assert.equal(r.degraded, false);
  assert.equal(r.degradationReason, null);
  assert.deepEqual(r.constructCapabilitiesActive.sort(), ['prompt-envelope', 'skills', 'worker-profiles', 'workflow-routing']);
});

test('same-family fallback → same-family-fallback mode and degraded=true', () => {
  const r = resolveExecution(
    { procedureId: 'evidence-ingest', requestedStrategy: 'orchestrated', hostModel: 'ide-builtin-unknown', hostProvider: 'anthropic' },
    { env: baseEnv() },
  );
  assertCommonShape(r);
  assert.equal(r.resolutionSource, 'same-family-fallback');
  assert.equal(r.executionMode, 'same-family-fallback');
  assert.equal(r.effectiveStrategy, 'orchestrated');
  assert.equal(r.degraded, true);
  assert.match(r.degradationReason, /same-family/i);
});

test('prompt-only by request → construct-prompt-only, not degraded', () => {
  const r = resolveExecution(
    { procedureId: 'evidence-ingest', requestedStrategy: 'prompt-only', hostModel: ANTHROPIC_MODEL },
    { env: baseEnv() },
  );
  assertCommonShape(r);
  assert.equal(r.executionMode, 'construct-prompt-only');
  assert.equal(r.effectiveStrategy, 'prompt-only');
  assert.equal(r.degraded, false);
  assert.deepEqual(r.constructCapabilitiesActive, ['prompt-envelope']);
});

test('orchestrated requested but model unresolvable → degraded prompt-only with reason', () => {
  const r = resolveExecution(
    { procedureId: 'architecture-review', requestedStrategy: 'orchestrated', hostModel: 'mystery/unknown', hostProvider: 'mystery' },
    { env: {} },
  );
  assertCommonShape(r);
  assert.equal(r.orchestrationAvailable, false);
  assert.equal(r.executionMode, 'construct-prompt-only');
  assert.equal(r.degraded, true);
  assert.match(r.degradationReason, /runnable model/i);
});

test('useConstruct=false → host-direct with no Construct capabilities', () => {
  const r = resolveExecution(
    { requestedStrategy: 'orchestrated', useConstruct: false, hostModel: ANTHROPIC_MODEL },
    { env: baseEnv() },
  );
  assertCommonShape(r);
  assert.equal(r.executionMode, 'host-direct');
  assert.equal(r.effectiveStrategy, 'host-direct');
  assert.deepEqual(r.constructCapabilitiesActive, []);
  assert.equal(r.degraded, false);
});

test('auto on a resolvable known Procedure orchestrates', () => {
  const r = resolveExecution(
    { procedureId: 'prd-draft', requestedStrategy: 'auto', hostModel: ANTHROPIC_MODEL },
    { env: baseEnv() },
  );
  assert.equal(r.executionMode, 'construct-orchestrated');
  assert.equal(r.effectiveStrategy, 'orchestrated');
});

test('unknown Procedure warns and reports no orchestration plan', () => {
  const r = resolveExecution(
    { procedureId: 'not-a-real-procedure', requestedStrategy: 'orchestrated', hostModel: ANTHROPIC_MODEL },
    { env: baseEnv() },
  );
  assert.equal(r.orchestrationPlanned, false);
  assert.equal(r.executionMode, 'construct-prompt-only');
  assert.equal(r.degraded, true);
  assert.ok(r.warnings.some((w) => /not-a-real-procedure/.test(w)));
  assert.match(r.degradationReason || '', /not-a-real-procedure|no orchestration plan/i);
});

test('invalid requestedStrategy defaults to auto with a warning', () => {
  const r = resolveExecution(
    { procedureId: 'evidence-ingest', requestedStrategy: 'bogus', hostModel: ANTHROPIC_MODEL },
    { env: baseEnv() },
  );
  assert.equal(r.requestedStrategy, 'auto');
  assert.ok(r.warnings.some((w) => /bogus/.test(w)));
});

test('a credential value in env never appears in the response', () => {
  const canary = 'sk-secret-CANARY-do-not-leak-9876';
  const r = resolveExecution(
    { procedureId: 'evidence-ingest', requestedStrategy: 'orchestrated', hostModel: ANTHROPIC_MODEL },
    { env: baseEnv({ ANTHROPIC_API_KEY: canary, OPENROUTER_API_KEY: canary }) },
  );
  assert.ok(!JSON.stringify(r).includes(canary), 'no credential value leaks into the contract');
});
