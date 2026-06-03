/**
 * tests/ingest-strategy.test.mjs — unit tests for ingest strategy resolution.
 *
 * Pins precedence (env > config > default), the adapter default, the explicit
 * fallback default of "none", that provider strategy resolves and records a
 * provider/model, and that a CLI override beats env and config.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIngestStrategy, DEFAULT_INGEST_STRATEGY, DEFAULT_INGEST_FALLBACK } from '../lib/ingest/strategy.mjs';

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
  const r = resolveIngestStrategy({ config, env: { CX_MODEL_FAST: 'test-fast-model' } });
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
  const r = resolveIngestStrategy({ config: { ingest: { strategy: 'adapter', fallback: 'none' } }, env: { CX_MODEL_FAST: 'x' } });
  assert.equal(r.model, null);
  assert.equal(r.modelResolution, null);
});
