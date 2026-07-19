/**
 * tests/functional/pg-queue.functional.test.mjs — live Postgres queue semantics.
 *
 * Set DATABASE_URL (or CONSTRUCT_DATABASE_URL) to run. Set
 * CONSTRUCT_REQUIRE_POSTGRES_TEST=1 in team CI to make absence fail.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSqlClient, closeSqlClient } from '../../lib/storage/backend.mjs';
import { PostgresIntakeQueue } from '../../lib/queue/pg-queue.mjs';

function sampleEntry(id) {
  return {
    id,
    intake: { sourcePath: `/tmp/${id}.md`, outputPath: '/out', characters: 1 },
    triage: {
      intakeType: 'note',
      rdStage: 'discover',
      primaryOwner: 'engineer',
      recommendedChain: [],
      recommendedAction: 'file',
      risk: 'low',
      requiresApproval: false,
      confidence: 0.9,
      rationale: 'test',
    },
    suggestion: { lane: 'default', source: 'test' },
    related: [],
    excerpt: '',
    query: '',
  };
}

const sql = createSqlClient(process.env);
const requireLive = process.env.CONSTRUCT_REQUIRE_POSTGRES_TEST === '1';

if (!sql) {
  test('postgres queue functional tests skipped — no DATABASE_URL / sql client', () => {
    assert.equal(requireLive, false, 'CONSTRUCT_REQUIRE_POSTGRES_TEST=1 requires a live Postgres client');
  });
} else {
  const project = `cx-pg-queue-${Date.now()}`;
  const queue = new PostgresIntakeQueue({ sql, project, tenantId: 'local', leaseSeconds: 1 });

  test.after(async () => {
    await sql`DELETE FROM construct_queue_items WHERE project = ${project}`;
    await closeSqlClient(sql);
  });

  test('parallel claimers produce zero double-claims', async () => {
    await queue.ensureSchema();
    const ids = Array.from({ length: 8 }, (_, i) => `pkt-parallel-${i}`);
    await Promise.all(ids.map((id) => queue.enqueue(sampleEntry(id))));

    const claimed = await Promise.all(
      Array.from({ length: 12 }, (_, i) => queue.claim({ claimedBy: `worker-${i}` })),
    );
    const actual = claimed.filter(Boolean).map((entry) => entry.id);
    assert.equal(actual.length, ids.length);
    assert.equal(new Set(actual).size, ids.length);
  });

  test('expired lease makes an item reclaimable exactly once', async () => {
    const id = 'pkt-expired-lease';
    await queue.enqueue(sampleEntry(id));
    const first = await queue.claim({ claimedBy: 'worker-a', leaseSeconds: 1 });
    assert.equal(first.id, id);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const reclaimed = await Promise.all([
      queue.claim({ claimedBy: 'worker-b', leaseSeconds: 5 }),
      queue.claim({ claimedBy: 'worker-c', leaseSeconds: 5 }),
    ]);
    const actual = reclaimed.filter(Boolean);
    assert.equal(actual.length, 1);
    assert.equal(actual[0].id, id);
    assert.equal(actual[0].attempt, 2);
  });

  test('heartbeat renews a live claim and blocks crash-style reclamation until expiry', async () => {
    const id = 'pkt-heartbeat';
    await queue.enqueue(sampleEntry(id));
    const claimed = await queue.claim({ claimedBy: 'worker-live', leaseSeconds: 1 });
    assert.equal(claimed.id, id);
    const renewed = await queue.heartbeat(id, { workerId: 'worker-live', leaseSeconds: 5 });
    assert.equal(renewed.renewed, true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(await queue.claim({ claimedBy: 'worker-other', leaseSeconds: 1 }), null);
  });
}
