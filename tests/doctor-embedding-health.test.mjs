/**
 * tests/doctor-embedding-health.test.mjs — `construct doctor` embedding-model
 * health check (LMCP-K4).
 *
 * Covers lib/doctor/embedding-health.mjs: the active embedding model reports
 * as-is when it is not `local`; when `local` is active, @huggingface/transformers
 * resolving reports healthy, and a simulated resolution failure (injected
 * seam, so the assertion holds whether or not the package happens to be
 * installed on the machine running the suite) reports the same degrade-to-
 * hashing message lib/storage/embeddings-local.mjs's own runtime fallback
 * produces. Also covers the consistency watcher wiring: runAllChecks()
 * surfaces an `embedding-model-health` result — passed when transformers
 * resolves in this environment, since forcing a real module-resolution
 * failure through the public runAllChecks() surface would require
 * uninstalling the package.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkEmbeddingModelForDoctor } from '../lib/doctor/embedding-health.mjs';
import { runAllChecks } from '../lib/doctor/watchers/consistency.mjs';

test('checkEmbeddingModelForDoctor: non-local model reports configuration without probing transformers', async () => {
  const check = await checkEmbeddingModelForDoctor({ env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' } });
  assert.equal(check.ok, true);
  assert.equal(check.degraded, false);
  assert.match(check.label, /Embedding model: hashing/);
});

test('checkEmbeddingModelForDoctor: local model with transformers resolving reports healthy', async () => {
  const check = await checkEmbeddingModelForDoctor({
    env: { CONSTRUCT_EMBEDDING_MODEL: 'local' },
    importTransformers: async () => ({}),
  });
  assert.equal(check.ok, true);
  assert.equal(check.degraded, false);
  assert.match(check.label, /Embedding model: local/);
  assert.match(check.label, /resolves/);
});

test('checkEmbeddingModelForDoctor: local model with transformers unresolvable reports the degrade-to-hashing message', async () => {
  const check = await checkEmbeddingModelForDoctor({
    env: { CONSTRUCT_EMBEDDING_MODEL: 'local' },
    importTransformers: async () => { throw new Error('Cannot find module \'@huggingface/transformers\''); },
  });
  assert.equal(check.ok, true);
  assert.equal(check.degraded, true);
  assert.match(check.label, /not installed/);
  assert.match(check.label, /hashing-bow-v1/);
  assert.match(check.label, /CONSTRUCT_EMBEDDING_MODEL=hashing/);
});

test('checkEmbeddingModelForDoctor: default env (no CONSTRUCT_EMBEDDING_MODEL) resolves the local default, never throws', async () => {
  const check = await checkEmbeddingModelForDoctor({ env: {} });
  assert.equal(check.ok, true);
  assert.equal(typeof check.degraded, 'boolean');
  assert.match(check.label, /Embedding model: local/);
});

test('consistency watcher: runAllChecks surfaces embedding-model-health, never blocking', async () => {
  const result = await runAllChecks();
  const passedEntry = result.passed.find((p) => p.category === 'embedding-model-health');
  const findingEntries = result.findings.filter((f) => f.category === 'embedding-model-health');
  assert.ok(passedEntry || findingEntries.length > 0, 'expected an embedding-model-health result either way');
  assert.ok(findingEntries.every((f) => f.severity === 'warning' && f.tier === 'actionable'));
});
