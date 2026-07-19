/**
 * tests/engine-consolidate.test.mjs — sleep-time consolidation tests.
 *
 * Verifies:
 *   - Near-duplicate observations (cosine > threshold) merge into a single
 *     consolidated insight whose hitCount reflects the cluster size.
 *   - Distinct observations stay as separate clusters.
 *   - Old, low-confidence observations are archived to .construct/observations/archive/.
 *   - The index.json is updated to drop archived entries.
 *   - A Compressor-shaped summariser is invoked when present and falls back
 *     to the representative's summary when absent.
 *   - The pass is idempotent on stable input.
 *   - Supersede (construct-xh6c): a tight restatement is archived behind a
 *     supersededBy pointer and the highest-salience member stays live and
 *     becomes the representative; a cluster-adjacent but non-duplicate member is
 *     kept; the pass is a no-op when supersedeDuplicates is off.
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
  fs.rmSync(path.join(tmpRoot, '.construct'), { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpRoot, '.construct', 'observations'), { recursive: true });
});

function writeObservation(id, summary, embedding, extras = {}) {
  const obsDir = path.join(tmpRoot, '.construct', 'observations');
  const record = {
    id,
    summary,
    content: summary,
    tags: [],
    role: 'engineer',
    category: 'pattern',
    confidence: extras.confidence ?? 0.8,
    createdAt: extras.createdAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(path.join(obsDir, `${id}.json`), JSON.stringify(record, null, 2));
  return { id, embedding };
}

function writeIndexAndVectors(records) {
  const obsDir = path.join(tmpRoot, '.construct', 'observations');
  const index = records.map((r) => ({ id: r.id, role: 'engineer', category: 'pattern' }));
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
      fs.readFileSync(path.join(tmpRoot, '.construct', 'observations', 'consolidated.json'), 'utf8')
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
      fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'archive', 'stale.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'stale.json')),
      false
    );
    const index = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, '.construct', 'observations', 'index.json'), 'utf8')
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
      fs.readFileSync(path.join(tmpRoot, '.construct', 'observations', 'consolidated.json'), 'utf8')
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
    const c1 = fs.readFileSync(path.join(tmpRoot, '.construct', 'observations', 'consolidated.json'), 'utf8');
    const c2 = fs.readFileSync(path.join(tmpRoot, '.construct', 'observations', 'consolidated.json'), 'utf8');
    assert.equal(c1, c2);
  });

  it('returns zero counts when there are no observations', async () => {
    fs.rmSync(path.join(tmpRoot, '.construct'), { recursive: true, force: true });
    const result = await consolidate(tmpRoot);
    assert.equal(result.clustersBefore, 0);
    assert.equal(result.clusters, 0);
    assert.deepEqual(result.archived, []);
  });

  it('supersedes a tight restatement, keeping the highest-salience member live', async () => {
    const earlier = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const later = new Date().toISOString();
    const weak = writeObservation('weak', 'retry uses fixed backoff', [1, 0, 0], { confidence: 0.4, createdAt: earlier });
    const strong = writeObservation('strong', 'retry uses fixed backoff', [0.999, 0.001, 0], { confidence: 0.9, createdAt: later });
    writeIndexAndVectors([weak, strong]);

    const result = await consolidate(tmpRoot, { similarityThreshold: 0.95, supersedeThreshold: 0.97 });

    assert.deepEqual(result.superseded, [{ id: 'weak', supersededBy: 'strong', reason: 'restatement' }],
      'the lower-salience member is superseded by the higher one');
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'strong.json')), true,
      'the winner stays live');
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'weak.json')), false,
      'the loser leaves the live store');

    const archived = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, '.construct', 'observations', 'archive', 'weak.json'), 'utf8')
    );
    assert.equal(archived.supersededBy, 'strong', 'the archived loser records what replaced it');
    assert.ok(archived.supersededAt, 'and when');

    const consolidated = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, '.construct', 'observations', 'consolidated.json'), 'utf8')
    );
    assert.equal(consolidated[0].representativeId, 'strong', 'the winner is the representative');
    assert.deepEqual(consolidated[0].supersededIds, ['weak']);
  });

  it('keeps a cluster-adjacent member that is not a tight duplicate', async () => {
    const a = writeObservation('a', 'auth uses RS256', [1, 0, 0], { confidence: 0.9 });
    const b = writeObservation('b', 'auth roughly similar', [0.96, 0.28, 0], { confidence: 0.5 });
    writeIndexAndVectors([a, b]);

    const result = await consolidate(tmpRoot, { similarityThreshold: 0.95, supersedeThreshold: 0.99 });
    assert.deepEqual(result.superseded, [], 'below the supersede bar, nothing is archived');
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'b.json')), true);
  });

  it('does not supersede when supersedeDuplicates is off', async () => {
    const weak = writeObservation('weak', 'same fact', [1, 0, 0], { confidence: 0.4 });
    const strong = writeObservation('strong', 'same fact', [0.999, 0.001, 0], { confidence: 0.9 });
    writeIndexAndVectors([weak, strong]);

    const result = await consolidate(tmpRoot, { supersedeDuplicates: false, detectContradictions: false });
    assert.deepEqual(result.superseded, []);
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'weak.json')), true,
      'both members stay live when the decision layer is disabled');
  });

  it('archives the older of a contradicting pair (newest wins, even at higher salience)', async () => {
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    // The stale claim is the higher-salience one, proving recency beats salience
    // for a contradiction (the inverse of restatement supersede). One token
    // ("not") flips the claim, so cosine sits in the same-subject band.
    const stale = writeObservation('stale', 'sso login is supported on the gateway', [1, 0, 0, 0], { confidence: 0.9, createdAt: old });
    const fresh = writeObservation('fresh', 'sso login is not supported on the gateway', [0.9, 0.43, 0, 0], { confidence: 0.4, createdAt: now });
    writeIndexAndVectors([stale, fresh]);

    const result = await consolidate(tmpRoot, { contradictionMinSimilarity: 0.75 });
    assert.deepEqual(result.superseded, [{ id: 'stale', supersededBy: 'fresh', reason: 'contradiction' }]);
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'fresh.json')), true, 'the newer claim stays live');
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'stale.json')), false, 'the contradicted older claim leaves the live store');

    const archived = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, '.construct', 'observations', 'archive', 'stale.json'), 'utf8')
    );
    assert.equal(archived.supersededBy, 'fresh');
    assert.equal(archived.supersededReason, 'contradiction');
  });

  it('does not flag two distinct facts that merely cluster', async () => {
    const a = writeObservation('a', 'sso login is supported on the gateway', [1, 0, 0, 0], { confidence: 0.8 });
    const b = writeObservation('b', 'sso login is supported with mfa enabled', [0.9, 0.43, 0, 0], { confidence: 0.8 });
    writeIndexAndVectors([a, b]);

    const result = await consolidate(tmpRoot);
    assert.deepEqual(result.superseded.filter((s) => s.reason === 'contradiction'), [],
      'same polarity, no negation flip — not a contradiction');
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'b.json')), true);
  });

  it('an injected judge resolves a value-swap the heuristic abstains on', async () => {
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    // No negation cue, so the heuristic abstains; the judge supplies the
    // semantic verdict and the older value loses to the newer one.
    const stale = writeObservation('stale', 'gateway auth uses RS256', [1, 0, 0, 0], { createdAt: old });
    const fresh = writeObservation('fresh', 'gateway auth uses HS256', [0.9, 0.43, 0, 0], { createdAt: now });
    writeIndexAndVectors([stale, fresh]);

    const judge = { judge: () => ({ contradicts: true }) };
    const result = await consolidate(tmpRoot, { contradictionJudge: judge });
    assert.deepEqual(result.superseded, [{ id: 'stale', supersededBy: 'fresh', reason: 'contradiction' }]);
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'stale.json')), false);
  });

  it('without a judge, a value-swap is left alone (heuristic abstains)', async () => {
    const stale = writeObservation('stale', 'gateway auth uses RS256', [1, 0, 0, 0], { createdAt: new Date(Date.now() - 1000).toISOString() });
    const fresh = writeObservation('fresh', 'gateway auth uses HS256', [0.9, 0.43, 0, 0]);
    writeIndexAndVectors([stale, fresh]);

    const result = await consolidate(tmpRoot);
    assert.deepEqual(result.superseded.filter((s) => s.reason === 'contradiction'), []);
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'stale.json')), true,
      'both values stay live when no judge is available');
  });

  it('skips the contradiction scan above contradictionScanMax', async () => {
    const stale = writeObservation('stale', 'sso login is supported', [1, 0, 0, 0], { createdAt: new Date(Date.now() - 1000).toISOString() });
    const fresh = writeObservation('fresh', 'sso login is not supported', [0.9, 0.43, 0, 0]);
    writeIndexAndVectors([stale, fresh]);

    const result = await consolidate(tmpRoot, { contradictionScanMax: 1 });
    assert.equal(result.contradictionScanSkipped, true);
    assert.deepEqual(result.superseded.filter((s) => s.reason === 'contradiction'), []);
    assert.equal(fs.existsSync(path.join(tmpRoot, '.construct', 'observations', 'stale.json')), true,
      'nothing is archived when the scan is skipped');
  });
});
