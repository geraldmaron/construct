/**
 * tests/ingest-strategy.test.mjs — unit tests for ingest strategy resolution.
 *
 * Pins precedence (env > config > default), the adapter default, the explicit
 * fallback default of "none", that provider strategy resolves and records a
 * provider/model, and that a CLI override beats env and config.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIngestStrategy, DEFAULT_INGEST_STRATEGY, DEFAULT_INGEST_FALLBACK, DEFAULT_INGEST_ORCHESTRATION } from '../lib/ingest/strategy.mjs';

test('default resolution is adapter strategy with none fallback and no model', () => {
  const r = resolveIngestStrategy({ config: null, env: {} });
  assert.equal(r.strategy, DEFAULT_INGEST_STRATEGY);
  assert.equal(r.strategy, 'adapter');
  assert.equal(r.fallback, DEFAULT_INGEST_FALLBACK);
  assert.equal(r.fallback, 'none');
  assert.equal(r.model, null);
  assert.equal(r.provider, null);
});

test('config selects provider strategy and resolves a model', () => {
  const config = { ingest: { strategy: 'provider', fallback: 'adapter' } };
  const r = resolveIngestStrategy({ config, env: { CONSTRUCT_MODEL_FAST: 'test-fast-model' } });
  assert.equal(r.strategy, 'provider');
  assert.equal(r.fallback, 'adapter');
  assert.equal(r.model, 'test-fast-model');
  assert.ok(r.modelResolution);
});

test('env overrides config for strategy', () => {
  const config = { ingest: { strategy: 'provider' } };
  const r = resolveIngestStrategy({ config, env: { CONSTRUCT_INGEST_STRATEGY: 'adapter' } });
  assert.equal(r.strategy, 'adapter');
});

test('explicit override beats env and config', () => {
  const config = { ingest: { strategy: 'adapter' } };
  const r = resolveIngestStrategy({ config, env: { CONSTRUCT_INGEST_STRATEGY: 'adapter' }, override: 'provider' });
  assert.equal(r.strategy, 'provider');
});

test('invalid values fall back to defaults rather than throwing', () => {
  const config = { ingest: { strategy: 'bogus', fallback: 'bogus' } };
  const r = resolveIngestStrategy({ config, env: {} });
  assert.equal(r.strategy, 'adapter');
  assert.equal(r.fallback, 'none');
});

test('adapter strategy does not resolve a provider model', () => {
  const r = resolveIngestStrategy({ config: { ingest: { strategy: 'adapter', fallback: 'none' } }, env: { CONSTRUCT_MODEL_FAST: 'x' } });
  assert.equal(r.model, null);
  assert.equal(r.modelResolution, null);
});

const MODEL_ENV = { CONSTRUCT_MODEL_REASONING: 'anthropic/claude-sonnet-4-6', CONSTRUCT_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6', CONSTRUCT_MODEL_FAST: 'anthropic/claude-sonnet-4-6' };

test('orchestration axis defaults to prompt-only and coexists with the extraction axis', () => {
  const r = resolveIngestStrategy({ config: null, env: MODEL_ENV });
  assert.equal(r.orchestration, DEFAULT_INGEST_ORCHESTRATION);
  assert.equal(r.orchestration, 'prompt-only');
  assert.equal(r.strategy, 'adapter');
  assert.ok(r.execution, 'execution-capability block attached');
  assert.equal(r.execution.executionMode, 'construct-prompt-only');
});

test('config selects orchestrated; execution reports construct-orchestrated', () => {
  const r = resolveIngestStrategy({ config: { ingest: { orchestration: 'orchestrated' } }, env: MODEL_ENV });
  assert.equal(r.orchestration, 'orchestrated');
  assert.equal(r.execution.executionMode, 'construct-orchestrated');
  assert.deepEqual(r.execution.constructCapabilitiesActive.sort(), ['personas', 'prompt-envelope', 'skills', 'workflow-routing']);
});

test('env CONSTRUCT_INGEST_ORCHESTRATION overrides config; explicit override beats both', () => {
  const config = { ingest: { orchestration: 'orchestrated' } };
  assert.equal(resolveIngestStrategy({ config, env: { ...MODEL_ENV, CONSTRUCT_INGEST_ORCHESTRATION: 'prompt-only' } }).orchestration, 'prompt-only');
  assert.equal(resolveIngestStrategy({ config, env: { ...MODEL_ENV, CONSTRUCT_INGEST_ORCHESTRATION: 'prompt-only' }, orchestrationOverride: 'orchestrated' }).orchestration, 'orchestrated');
});

test('invalid orchestration value falls back to the default', () => {
  const r = resolveIngestStrategy({ config: { ingest: { orchestration: 'bogus' } }, env: MODEL_ENV });
  assert.equal(r.orchestration, 'prompt-only');
});
