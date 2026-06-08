/**
 * tests/embed/reconcile.test.mjs — observation index reconciliation tests.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reconcileObservationEmbeddings } from '../../lib/embed/reconcile.mjs';
import { addObservation } from '../../lib/observation-store.mjs';

test("reconcile is idempotent on a healthy index", async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'cx-reconcile-test-'));
  t.after(() => rmSync(tmpDir, { recursive: true, force: true }));
  mkdirSync(join(tmpDir, '.cx'), { recursive: true });

  process.env.CONSTRUCT_EMBEDDING_MODEL = 'hashing';
  process.env.CONSTRUCT_LANCEDB_PATH = join(tmpDir, '.cx', 'lancedb');

  await addObservation(tmpDir, { summary: 'test 1', project: 'p' });
  
  const result = await reconcileObservationEmbeddings(tmpDir);
  assert.equal(result.checked, 1);
  assert.equal(result.reembedded, 0, 'idempotent: already embedded with current model');

  const result2 = await reconcileObservationEmbeddings(tmpDir);
  assert.equal(result2.reembedded, 0);
});
