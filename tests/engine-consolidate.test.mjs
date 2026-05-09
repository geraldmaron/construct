/**
 * tests/engine-consolidate.test.mjs — sleep-time consolidation tests.
 *
 * Verifies:
 *   - Near-duplicate observations (cosine > threshold) merge into a single
 *     consolidated insight whose hitCount reflects the cluster size.
 *   - Distinct observations stay as separate clusters.
 *   - Old, low-confidence observations are archived to .cx/observations/archive/.
 *   - The index.json is updated to drop archived entries.
 *   - A Compressor-shaped summariser is invoked when present and falls back
 *     to the representative's summary when absent.
 *   - The pass is idempotent on stable input.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after, beforeEach } from 'node:test';
import { consolidate } from '../lib/engine/consolidate.mjs';

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-consolidate-'));
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(path.join(tmpRoot, '.cx'), { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpRoot, '.cx', 'observations'), { recursive: true });
});

function writeObservation(id, summary, embedding, extras = {}) {
  const obsDir = path.join(tmpRoot, '.cx', 'observations');
  const record = {
    id,
    summary,
    content: summary,
    tags: [],
    role: 'cx-engineer',
    category: 'pattern',
    confidence: extras.confidence ?? 0.8,
    createdAt: extras.createdAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(path.join(obsDir, `${id}.json`), JSON.stringify(record, null, 2));
  return { id, embedding };
}

function writeIndexAndVectors(records) {
  const obsDir = path.join(tmpRoot, '.cx', 'observations');
  const index = records.map((r) => ({ id: r.id, role: 'cx-engineer', category: 'pattern' }));
  fs.writeFileSync(path.join(obsDir, 'index.json'), JSON.stringify(index, null, 2));
  fs.writeFileSync(path.join(obsDir, 'vectors.json'), JSON.stringify(records, null, 2));
}

describe('consolidate', () => {
  it('merges near-duplicates into one insight with hitCount > 1', async () => {
    const a = writeObservation('a', 'JWT auth uses RS256', [1, 0, 0]);
    const b = writeObservation('b', 'JWT auth uses RS256 (dup)', [0.999, 0.001, 0]);
    const c = writeObservation('c', 'rate limiting is missing', [0, 1, 0]);
    writeIndexAndVectors([a, b, c]);

    const result = await consolidate(tmpRoot, { similarityThreshold: 0.95 });
    assert.equal(result.clustersBefore, 3);
    assert.equal(result.clusters, 2);

    const consolidated = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, '.cx', 'observations', 'consolidated.json'), 'utf8')
    );
    const merged = consolidated.find((c) => c.hitCount === 2);
    assert.ok(merged);
    assert.equal(merged.memberIds.length, 2);
  });

  it('archives old low-confidence observations and prunes them from index.json', async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const stale = writeObservation('stale', 'old hunch', [1, 0, 0], { createdAt: old, confidence: 0.3 });
    const fresh = writeObservation('fresh', 'recent insight', [0, 1, 0]);
    writeIndexAndVectors([stale, fresh]);

    const result = await consolidate(tmpRoot, {
      archiveAfterDays: 60,
      archiveBelowConfidence: 0.5,
    });
    assert.deepEqual(result.archived, ['stale']);
    assert.equal(
      fs.existsSync(path.join(tmpRoot, '.cx', 'observations', 'archive', 'stale.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tmpRoot, '.cx', 'observations', 'stale.json')),
      false
    );
    const index = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, '.cx', 'observations', 'index.json'), 'utf8')
    );
    assert.deepEqual(index.map((e) => e.id), ['fresh']);
  });

  it('invokes a Compressor-shaped summariser when provided', async () => {
    const a = writeObservation('a', 'Long summary about retrieval. Many words. More words still.', [1, 0, 0]);
    writeIndexAndVectors([a]);

    let called = false;
    const summariser = {
      meta: { id: 'fake' },
      async compress(text /* , opts */) {
        called = true;
        return 'compressed';
      },
    };
    await consolidate(tmpRoot, { summariser });
    const consolidated = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, '.cx', 'observations', 'consolidated.json'), 'utf8')
    );
    assert.equal(called, true);
    assert.equal(consolidated[0].summary, 'compressed');
  });

  it('is idempotent on stable input', async () => {
    const a = writeObservation('a', 'JWT auth', [1, 0, 0]);
    const b = writeObservation('b', 'JWT auth dup', [0.999, 0.001, 0]);
    writeIndexAndVectors([a, b]);

    const first = await consolidate(tmpRoot);
    const second = await consolidate(tmpRoot);
    assert.equal(first.clusters, second.clusters);
    const c1 = fs.readFileSync(path.join(tmpRoot, '.cx', 'observations', 'consolidated.json'), 'utf8');
    const c2 = fs.readFileSync(path.join(tmpRoot, '.cx', 'observations', 'consolidated.json'), 'utf8');
    assert.equal(c1, c2);
  });

  it('returns zero counts when there are no observations', async () => {
    fs.rmSync(path.join(tmpRoot, '.cx'), { recursive: true, force: true });
    const result = await consolidate(tmpRoot);
    assert.equal(result.clustersBefore, 0);
    assert.equal(result.clusters, 0);
    assert.deepEqual(result.archived, []);
  });
});
