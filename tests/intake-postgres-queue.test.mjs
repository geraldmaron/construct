/**
 * tests/intake-postgres-queue.test.mjs — PostgresIntakeQueue integration tests.
 *
 * Gated on DATABASE_URL (and on a reachable Postgres). Runs the schema
 * migrations against the test database, then exercises enqueue,
 * listPending, count, read, markProcessed, markSkipped, reopen, and the
 * concurrent claim() path that depends on FOR UPDATE SKIP LOCKED for
 * worker safety. CI runs this in the `postgres-integration` job.
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

import { PostgresIntakeQueue } from '../lib/intake/queue.mjs';
import { runMigrations } from '../lib/storage/migrations.mjs';

const DATABASE_URL = process.env.DATABASE_URL || process.env.CONSTRUCT_TEST_DATABASE_URL;
const skip = !DATABASE_URL;

describe('PostgresIntakeQueue (integration)', { skip }, () => {
  let sql;
  let queue;
  const project = `intake-test-${Date.now()}`;

  before(async () => {
    const postgres = (await import('postgres')).default;
    sql = postgres(DATABASE_URL, { max: 5 });
    await runMigrations(sql);
    queue = new PostgresIntakeQueue({ sql, project });
  });

  after(async () => {
    if (sql) {
      try {
        await sql`DELETE FROM construct_intake_items WHERE project = ${project}`;
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  });

  function sampleEntry(overrides = {}) {
    return {
      intake: { sourcePath: '/tmp/example.pdf', outputPath: '/tmp/example.md', characters: 1234, knowledgeSubdir: 'reference' },
      triage: {
        intakeType: 'bug',
        rdStage: 'implementation',
        primaryOwner: 'debugger',
        recommendedChain: ['debugger', 'engineer', 'qa', 'reviewer'],
        recommendedAction: 'diagnose',
        risk: 'medium',
        requiresApproval: false,
        confidence: 0.7,
        rationale: 'Test packet.',
      },
      suggestion: { lane: 'postmortems', source: 'docs-routing.suggestDocsLaneForFile' },
      related: [],
      excerpt: 'pretend extracted content',
      query: 'example pdf',
      ...overrides,
    };
  }

  it('enqueues with flattened triage columns + payload jsonb', async () => {
    const { id } = await queue.enqueue(sampleEntry());
    const rows = await sql`SELECT * FROM construct_intake_items WHERE id = ${id}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].intake_type, 'bug');
    assert.equal(rows[0].primary_owner, 'debugger');
    assert.equal(rows[0].project, project);
  });

  it('listPending sorts oldest-first and scopes by project', async () => {
    const before = await queue.count();
    await queue.enqueue(sampleEntry({ intake: { sourcePath: '/tmp/a.md', outputPath: '/x', characters: 1 } }));
    await queue.enqueue(sampleEntry({ intake: { sourcePath: '/tmp/b.md', outputPath: '/x', characters: 1 } }));
    const pending = await queue.listPending();
    assert.ok(pending.length >= before + 2);
    for (let i = 1; i < pending.length; i++) {
      assert.ok(pending[i - 1].createdAt <= pending[i].createdAt, 'sorted oldest-first');
    }
  });

  it('markProcessed sets status + processedAt + notes', async () => {
    const { id } = await queue.enqueue(sampleEntry());
    await queue.markProcessed(id, { processedBy: 'test', notes: 'merged' });
    const entry = await queue.read(id);
    assert.equal(entry.status, 'processed');
    assert.equal(entry.processedBy, 'test');
    assert.equal(entry.notes, 'merged');
  });

  it('markSkipped sets status + skippedAt + reason', async () => {
    const { id } = await queue.enqueue(sampleEntry());
    await queue.markSkipped(id, { skippedBy: 'test', reason: 'noise' });
    const entry = await queue.read(id);
    assert.equal(entry.status, 'skipped');
    assert.equal(entry.reason, 'noise');
  });

  it('reopen moves processed entries back to pending and clears completion fields', async () => {
    const { id } = await queue.enqueue(sampleEntry());
    await queue.markProcessed(id, { processedBy: 'test', notes: 'note' });
    await queue.reopen(id);
    const entry = await queue.read(id);
    assert.equal(entry.status, 'pending');
    assert.equal(entry.processedAt, undefined);
    assert.equal(entry.notes, undefined);
  });

  it('errors clearly on unknown ids for markProcessed / markSkipped / reopen', async () => {
    await assert.rejects(() => queue.markProcessed('nope'), /no pending entry/);
    await assert.rejects(() => queue.markSkipped('nope'), /no pending entry/);
    await assert.rejects(() => queue.reopen('nope'), /no processed or skipped entry/);
  });

  it('claim() returns null when the queue is empty for this project', async () => {
    const emptyProject = `intake-empty-${Date.now()}`;
    const emptyQueue = new PostgresIntakeQueue({ sql, project: emptyProject });
    const r = await emptyQueue.claim({ claimedBy: 'worker-1' });
    assert.equal(r, null);
  });

  it('claim() is atomic — two concurrent workers cannot grab the same item', async () => {
    const raceProject = `intake-race-${Date.now()}`;
    const q = new PostgresIntakeQueue({ sql, project: raceProject });
    try {
      await q.enqueue(sampleEntry({ intake: { sourcePath: '/tmp/race.md', outputPath: '/x', characters: 1 } }));

      const [a, b] = await Promise.all([
        q.claim({ claimedBy: 'worker-A' }),
        q.claim({ claimedBy: 'worker-B' }),
      ]);

      const claimedIds = [a, b].filter(Boolean).map((r) => r.id);
      assert.equal(claimedIds.length, 1, 'exactly one worker can claim a single pending item');
      assert.ok([a?.claimedBy, b?.claimedBy].some((v) => v === 'worker-A' || v === 'worker-B'));
    } finally {
      await sql`DELETE FROM construct_intake_items WHERE project = ${raceProject}`;
    }
  });
});
