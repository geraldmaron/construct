/**
 * tests/oracle/semantic-review.test.mjs — Layer 3 bounded semantic review
 * (lib/oracle/semantic-review.mjs): seed corpus runners and status rollup.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  runSemanticReview,
  SEMANTIC_REVIEW_SEED_CORPUS,
} from '../../lib/oracle/semantic-review.mjs';

function tempDir(prefix, t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('SEMANTIC_REVIEW_SEED_CORPUS includes #408/#409/#410 audit rows', () => {
  assert.ok(SEMANTIC_REVIEW_SEED_CORPUS.length >= 4);
  const prScopes = new Set(SEMANTIC_REVIEW_SEED_CORPUS.flatMap((s) => s.prScope));
  assert.ok(prScopes.has('408'));
  assert.ok(prScopes.has('409'));
  assert.ok(prScopes.has('410'));
  assert.ok(SEMANTIC_REVIEW_SEED_CORPUS.some((s) => s.truthMatrixRow === 17));
  assert.ok(SEMANTIC_REVIEW_SEED_CORPUS.some((s) => s.truthMatrixRow === 8));
});

test('runSemanticReview on real repo detects monitor vs embed watch overlap', () => {
  const result = runSemanticReview({ rootDir: process.cwd() });
  assert.equal(result.layer, 3);
  assert.ok(['failed', 'passed', 'unknown', 'incomplete'].includes(result.overall));
  const dup = result.reviews.find((r) => r.id === 'duplicated-product-concept-monitor-vs-source-watch');
  assert.ok(dup);
  assert.equal(dup.status, 'failed');
});

test('runSemanticReview passes when envelope catch rethrows non-policy errors on real repo', () => {
  const result = runSemanticReview({ rootDir: process.cwd() });
  const latent = result.reviews.find((r) => r.id === 'latent-catch-swallows-non-primary-error');
  assert.ok(latent);
  assert.equal(latent.status, 'passed');
});

test('runSemanticReview combined-pr check fails without Layer 2 couplings', () => {
  const result = runSemanticReview({
    rootDir: process.cwd(),
    changedFiles: ['lib/oracle/cli.mjs', 'lib/embed/daemon.mjs', 'lib/writes/envelope.mjs'],
    layer2Couplings: [],
  });
  const combined = result.reviews.find((r) => r.id === 'combined-pr-incoherent-architecture');
  assert.ok(combined);
  assert.equal(combined.status, 'failed');
});

test('runSemanticReview combined-pr check passes when Layer 2 couplings present', () => {
  const result = runSemanticReview({
    rootDir: process.cwd(),
    changedFiles: ['lib/oracle/cli.mjs', 'lib/embed/daemon.mjs', 'lib/writes/envelope.mjs'],
    layer2Couplings: [{ rel: 'couples_state', from: 'a', to: 'b' }],
  });
  const combined = result.reviews.find((r) => r.id === 'combined-pr-incoherent-architecture');
  assert.ok(combined);
  assert.equal(combined.status, 'passed');
});

test('runSemanticReview degrades when modules are absent in empty tmpdir', (t) => {
  const rootDir = tempDir('cx-layer3-empty-', t);
  const result = runSemanticReview({ rootDir });
  assert.equal(result.layer, 3);
  const statuses = result.reviews.map((r) => r.status);
  assert.ok(statuses.includes('not-applicable') || statuses.includes('unknown'));
});
