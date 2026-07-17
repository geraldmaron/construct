/**
 * tests/embed-approval-queue-concurrency.test.mjs — cross-process dedup and
 * atomic-persist regression coverage for lib/embed/approval-queue.mjs.
 *
 * Two ApprovalQueue instances pointed at the same persistPath stand in for
 * two OS processes sharing one durable queue file (ADR-0056). Covers:
 *   1. enqueue() reloads from disk before its dedup check, so a second
 *      "process" enqueuing the same tool+args after the first never creates
 *      a duplicate awaiting_approval record.
 *   2. #persist() writes via temp-file + rename, so every reader ever sees
 *      either the prior complete file or the new complete file — never a
 *      torn/partial line — including when a read is forced to interleave
 *      with an in-flight write.
 *   3. approve()/deny()/expireStale()/reclaimExpiredLeases() reload before
 *      persisting (construct-4uxq0.9.9), so a decider or sweeper holding a
 *      stale instance never drops records sibling processes persisted, and
 *      a decision racing a sibling's opposite decision is refused with the
 *      state machine's invalid-transition error instead of clobbering it.
 *   4. Pure readers (getById/list/getPending/getByResumeToken/findByToolArgs)
 *      reload per call, so long-lived processes observe sibling transitions.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ApprovalQueue } from '../lib/embed/approval-queue.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

function freshPersistPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-approval-queue-concurrency-'));
  tmpDirs.push(dir);
  return path.join(dir, '.construct', 'approvals', 'queue.jsonl');
}

function readLines(persistPath) {
  if (!fs.existsSync(persistPath)) return [];
  return fs.readFileSync(persistPath, 'utf8').split('\n').filter(Boolean);
}

function assertValidJsonl(persistPath) {
  const lines = readLines(persistPath);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), `corrupted JSONL line in ${persistPath}: ${line}`);
  }
  return lines;
}

describe('ApprovalQueue — cross-process dedup', () => {
  it('a second instance reloads from disk before dedup, so interleaved enqueue never duplicates', () => {
    const persistPath = freshPersistPath();
    const spec = { tool: 'github.pr.merge', args: { number: 7 } };

    // q1 and q2 model two processes that both started before either wrote
    // anything, so both begin with an empty in-memory view.
    const q1 = new ApprovalQueue({ persistPath });
    const q2 = new ApprovalQueue({ persistPath });

    const r1 = q1.enqueue(spec);
    // q2's in-memory #items is still empty at this point; without the
    // pre-dedup reload it would see no existing record and create a
    // duplicate awaiting_approval row for the same tool+args.
    const r2 = q2.enqueue(spec);

    assert.equal(r2.approvalId, r1.approvalId, 'second process must see the first process record instead of duplicating it');

    const lines = assertValidJsonl(persistPath);
    assert.equal(lines.length, 1, 'exactly one persisted record for the deduped tool+args');
  });

  it('many interleaved enqueue calls across two instances converge to one record per distinct tool+args', () => {
    const persistPath = freshPersistPath();
    const q1 = new ApprovalQueue({ persistPath });
    const q2 = new ApprovalQueue({ persistPath });
    const queues = [q1, q2];

    const tools = ['a.action', 'b.action', 'c.action'];
    const seenIds = new Map();

    for (let round = 0; round < 6; round++) {
      for (const tool of tools) {
        const q = queues[round % 2];
        const rec = q.enqueue({ tool, args: { round: 0 } });
        if (seenIds.has(tool)) {
          assert.equal(rec.approvalId, seenIds.get(tool), `${tool} should dedup to the same approvalId across interleaved processes`);
        } else {
          seenIds.set(tool, rec.approvalId);
        }
      }
    }

    const lines = assertValidJsonl(persistPath);
    assert.equal(lines.length, tools.length, 'one record per distinct tool, regardless of which instance enqueued it or in what order');
  });
});

describe('ApprovalQueue — atomic persist under racing reads', () => {
  it('never leaves a torn/partial queue file when a read races an in-flight write', () => {
    const persistPath = freshPersistPath();
    const q1 = new ApprovalQueue({ persistPath });
    q1.enqueue({ tool: 'seed.tool', args: { n: 0 } });

    const originalWriteFileSync = fs.writeFileSync;
    const originalRenameSync = fs.renameSync;
    const observations = [];

    // #persist() writes the new content to a `<persistPath>.<pid>.<n>.tmp`
    // sibling file, never touching persistPath directly until renameSync.
    // Racing a read against that tmp write must therefore still observe the
    // prior complete file at persistPath, proving readers can never land
    // mid-write.
    fs.writeFileSync = function patchedWriteFileSync(target, ...rest) {
      if (typeof target === 'string' && target.startsWith(persistPath) && target !== persistPath) {
        observations.push({ phase: 'mid-tmp-write', lines: assertValidJsonl(persistPath) });
      }
      return originalWriteFileSync.call(fs, target, ...rest);
    };
    fs.renameSync = function patchedRenameSync(src, dest) {
      if (dest === persistPath) {
        observations.push({ phase: 'pre-rename', lines: assertValidJsonl(persistPath) });
        const result = originalRenameSync.call(fs, src, dest);
        observations.push({ phase: 'post-rename', lines: assertValidJsonl(persistPath) });
        return result;
      }
      return originalRenameSync.call(fs, src, dest);
    };

    try {
      const q2 = new ApprovalQueue({ persistPath });
      for (let i = 1; i <= 5; i++) {
        q1.enqueue({ tool: `race.tool.${i}`, args: { n: i } });
        q2.enqueue({ tool: `race.tool.${i}`, args: { n: i } });
      }
    } finally {
      fs.writeFileSync = originalWriteFileSync;
      fs.renameSync = originalRenameSync;
    }

    assert.ok(observations.length > 0, 'expected the persist path to be exercised during interleaved enqueue calls');

    const preRename = observations.filter((o) => o.phase === 'pre-rename');
    const postRename = observations.filter((o) => o.phase === 'post-rename');
    assert.ok(preRename.length > 0);
    assert.ok(postRename.length > 0);
    for (let i = 0; i < preRename.length; i++) {
      assert.ok(postRename[i].lines.length >= preRename[i].lines.length, 'rename only ever grows or replaces content with a complete snapshot, never truncates mid-flight');
    }

    const finalLines = assertValidJsonl(persistPath);
    assert.equal(finalLines.length, 6, 'seed record plus one deduped record per race.tool.N survive with no corruption');
  });
});

describe('ApprovalQueue — decide path reloads before persisting', () => {
  it('a record enqueued by process B survives an approve() by process A whose instance predates it', () => {
    const persistPath = freshPersistPath();
    const q1 = new ApprovalQueue({ persistPath });
    const recA = q1.enqueue({ tool: 'a.tool', args: { n: 1 } });

    // qStale models a decider process (CLI) that loaded the queue before the
    // daemon persisted recB; without the pre-decide reload its whole-file
    // persist would silently drop recB.
    const qStale = new ApprovalQueue({ persistPath });
    const recB = q1.enqueue({ tool: 'b.tool', args: { n: 2 } });

    const approved = qStale.approve(recA.approvalId, { decidedBy: { userId: 'alice' } });
    assert.equal(approved.state, 'approved');

    const fresh = new ApprovalQueue({ persistPath });
    const survivor = fresh.getById(recB.approvalId);
    assert.ok(survivor, 'record enqueued by the sibling process must survive the stale decider\'s persist');
    assert.equal(survivor.state, 'awaiting_approval');
    assert.equal(fresh.getById(recA.approvalId).state, 'approved');
    assert.equal(assertValidJsonl(persistPath).length, 2, 'both records persisted, no lost update');
  });

  it('approve() racing a sibling\'s deny() is refused with the invalid-transition error, not clobbered', () => {
    const persistPath = freshPersistPath();
    const q1 = new ApprovalQueue({ persistPath });
    const rec = q1.enqueue({ tool: 'contested.tool', args: {} });

    const qStale = new ApprovalQueue({ persistPath });
    q1.deny(rec.approvalId, { reason: 'sibling said no' });

    assert.throws(
      () => qStale.approve(rec.approvalId, { decidedBy: { userId: 'bob' } }),
      /already denied/,
      'the stale approver must be refused once the reload reveals the sibling\'s denial',
    );

    const fresh = new ApprovalQueue({ persistPath });
    const final = fresh.getById(rec.approvalId);
    assert.equal(final.state, 'denied', 'the sibling\'s denial must stand');
    assert.equal(final.reason, 'sibling said no');
  });

  it('expireStale() on a stale instance neither drops sibling records nor expires ones a sibling already resolved', async () => {
    const persistPath = freshPersistPath();
    const q1 = new ApprovalQueue({ persistPath, timeoutMs: 10 });
    const doomed = q1.enqueue({ tool: 'doomed.tool', args: {} });
    const saved = q1.enqueue({ tool: 'saved.tool', args: {} });

    const qStale = new ApprovalQueue({ persistPath, timeoutMs: 10 });
    const late = q1.enqueue({ tool: 'late.tool', args: {} });
    q1.approve(saved.approvalId);

    await new Promise((r) => setTimeout(r, 20));
    const expired = qStale.expireStale();
    const expiredIds = expired.map((r) => r.approvalId).sort();
    assert.deepEqual(expiredIds, [doomed.approvalId, late.approvalId].sort(), 'only still-awaiting past-expiry records expire; the sibling-approved one does not');

    const fresh = new ApprovalQueue({ persistPath });
    assert.equal(fresh.getById(late.approvalId).state, 'expired', 'sibling-enqueued record survives the sweep\'s persist');
    assert.equal(fresh.getById(saved.approvalId).state, 'approved', 'sibling\'s approval survives the sweep');
    assert.equal(assertValidJsonl(persistPath).length, 3);
  });

  it('reclaimExpiredLeases() on a stale instance preserves sibling-enqueued records', async () => {
    const persistPath = freshPersistPath();
    const q1 = new ApprovalQueue({ persistPath });
    const leased = q1.enqueue({ tool: 'leased.tool', args: {} });
    q1.approve(leased.approvalId);
    q1.acquireLease(leased.approvalId, { leaseSeconds: 0.01, workerId: 'crashed-worker' });

    const qStale = new ApprovalQueue({ persistPath });
    const late = q1.enqueue({ tool: 'late.tool', args: {} });

    await new Promise((r) => setTimeout(r, 30));
    const reclaimed = qStale.reclaimExpiredLeases();
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0].state, 'approved');

    const fresh = new ApprovalQueue({ persistPath });
    assert.ok(fresh.getById(late.approvalId), 'sibling-enqueued record survives the reclaim sweep\'s persist');
    assert.equal(assertValidJsonl(persistPath).length, 2);
  });
});

describe('ApprovalQueue — pure readers observe sibling-process state', () => {
  it('getById/list/getPending/getByResumeToken/findByToolArgs reflect transitions persisted by a sibling instance', () => {
    const persistPath = freshPersistPath();
    const longLived = new ApprovalQueue({ persistPath });
    const rec = longLived.enqueue({ tool: 'watched.tool', args: { n: 1 } });

    const sibling = new ApprovalQueue({ persistPath });
    sibling.approve(rec.approvalId, { decidedBy: { userId: 'alice' } });
    const other = sibling.enqueue({ tool: 'other.tool', args: { n: 2 } });

    assert.equal(longLived.getById(rec.approvalId).state, 'approved', 'getById must not serve the construction-time snapshot');
    assert.equal(longLived.list('approved').length, 1);
    assert.equal(longLived.list().length, 2, 'list must surface the sibling\'s new record');
    assert.deepEqual(longLived.getPending().map((r) => r.approvalId), [other.approvalId]);
    assert.equal(longLived.getByResumeToken(other.resumeToken)?.approvalId, other.approvalId);
    assert.equal(
      longLived.findByToolArgs('other.tool', other.toolCall.argsHash)?.approvalId,
      other.approvalId,
    );
  });

  it('reload preserves reference identity: a record held across a sibling transition updates in place', () => {
    const persistPath = freshPersistPath();
    const longLived = new ApprovalQueue({ persistPath });
    const held = longLived.enqueue({ tool: 'held.tool', args: {} });

    const sibling = new ApprovalQueue({ persistPath });
    sibling.deny(held.approvalId, { reason: 'nope' });

    const reread = longLived.getById(held.approvalId);
    assert.equal(reread, held, 'reload must merge into the existing object, not replace it');
    assert.equal(held.state, 'denied');
    assert.equal(held.reason, 'nope');
  });
});
