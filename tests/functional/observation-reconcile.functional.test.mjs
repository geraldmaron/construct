/**
 * tests/functional/observation-reconcile.functional.test.mjs
 *
 * End-to-end reconciliation against real pgvector: observations created while
 * Postgres was "down" (inline embed skipped, local store only) are back-filled
 * into pg by reconcileObservationEmbeddings, stamped with (content_hash, model),
 * and a second pass is a no-op. A deterministic fake 384-dim embedder keeps the
 * test fast — the reconcile LOGIC is under test, not the ONNX embedder.
 *
 * Skips when Docker isn't available (withPostgres returns null).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPostgres } from './_lib/postgres-docker.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Deterministic 384-dim "embedding" derived from the text — orthogonal to the
// real ONNX model, sufficient for the reconcile selection/upsert assertions.

function fakeEmbed(text) {
  const v = new Float32Array(384);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h = Math.imul(h ^ text.charCodeAt(i), 16777619); }
  for (let i = 0; i < 384; i += 1) { h = Math.imul(h ^ i, 16777619); v[i] = ((h >>> 0) % 1000) / 1000; }
  return { embedding: v, model: 'test-model', dimensions: 384 };
}

test('reconcile back-fills missing observations and is idempotent', async (t) => {
  const pg = await withPostgres(t);
  if (!pg) return;

  const root = mkdtempSync(join(tmpdir(), 'recon-fn-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const prev = process.env.DATABASE_URL;
  t.after(() => {
    if (prev !== undefined) process.env.DATABASE_URL = prev;
    else delete process.env.DATABASE_URL;
  });

  // The schema column is vector(384); pin the 384-dim model so the dimension
  // assertion holds regardless of the ambient CONSTRUCT_EMBEDDING_MODEL (the CI
  // unit job pins hashing=256). 'local' reports its dimension statically — no
  // ONNX load.
  const prevModel = process.env.CONSTRUCT_EMBEDDING_MODEL;
  process.env.CONSTRUCT_EMBEDDING_MODEL = 'local';
  t.after(() => {
    if (prevModel !== undefined) process.env.CONSTRUCT_EMBEDDING_MODEL = prevModel;
    else delete process.env.CONSTRUCT_EMBEDDING_MODEL;
  });

  // Seed with pg "down": inline embedding is skipped, local store is authoritative.
  delete process.env.DATABASE_URL;
  const { addObservation } = await import(join(REPO_ROOT, 'lib', 'observation-store.mjs'));
  for (const s of ['alpha insight', 'beta insight', 'gamma insight']) {
    await addObservation(root, {
      role: 'cx-engineer', category: 'pattern', summary: s, content: `${s} body`,
      tags: ['t'], project: 'reconproj', confidence: 0.8, source: 'manual',
    });
  }

  // pg "up": reconcile back-fills all three.
  process.env.DATABASE_URL = pg.url;
  const { reconcileObservationEmbeddings } = await import(join(REPO_ROOT, 'lib', 'embed', 'reconcile.mjs'));
  const embed = async (text) => fakeEmbed(text);

  const r1 = await reconcileObservationEmbeddings(root, { embed, modelId: 'test-model' });
  assert.equal(r1.checked, 3);
  assert.equal(r1.reembedded, 3);

  const r2 = await reconcileObservationEmbeddings(root, { embed, modelId: 'test-model' });
  assert.equal(r2.reembedded, 0, 'second pass re-embeds nothing');

  const rows = await pg.client`
    SELECT content_hash, model, (embedding IS NOT NULL) AS has_emb
    FROM construct_observations WHERE project = 'reconproj'
  `;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.content_hash && r.model === 'test-model' && r.has_emb),
    'every row is embedded and stamped with (content_hash, model)');
});
