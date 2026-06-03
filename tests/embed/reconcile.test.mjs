/**
 * tests/embed/reconcile.test.mjs — offline guards for observation reconciliation:
 * a clean no-op without a Postgres backend, and a (content_hash) half of the
 * fingerprint computed identically by the writer and the reconciler.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileObservationEmbeddings } from '../../lib/embed/reconcile.mjs';
import { observationSearchText, observationContentHash } from '../../lib/observation-store.mjs';

test('reconcile skips cleanly when no Postgres backend is configured', async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const r = await reconcileObservationEmbeddings('/tmp/does-not-matter');
    assert.equal(r.skipped, 'no-pg');
    assert.equal(r.reembedded, 0);
    assert.equal(r.checked, 0);
  } finally {
    if (prev !== undefined) process.env.DATABASE_URL = prev;
  }
});

test('search text and content hash are deterministic and order-stable', () => {
  const obs = { summary: 'sum', content: 'body', tags: ['b', 'a'] };
  assert.equal(observationSearchText(obs), 'sum body b a');
  assert.equal(observationContentHash('sum body b a'), observationContentHash(observationSearchText(obs)));
  // A content change changes the hash; identical content does not.
  assert.notEqual(observationContentHash('sum body b a'), observationContentHash('sum body b a EDIT'));
});

test('content hash tolerates missing fields', () => {
  assert.equal(observationSearchText({ summary: 'x' }), 'x');
  assert.equal(typeof observationContentHash(observationSearchText({})), 'string');
});
