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
