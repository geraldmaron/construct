/**
 * tests/oracle-approval-triage.test.mjs — one-shot flush of the oracle
 * pending.jsonl backlog to one representative row per dedupKey.
 *
 * A backlog accumulated before enqueue-time dedupe
 * landed carries many duplicate rows sharing a dedupKey.
 * triagePending collapses each group to one survivor with an accumulated
 * occurrenceCount, archives the rest to pending-archive.jsonl so the
 * original rows stay recoverable, and never touches already-approved rows.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { listPending, triagePending, approvePending } from '../lib/oracle/actions.mjs';

function freshProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'construct-oracle-triage-'));
  mkdirSync(join(projectDir, '.construct', 'oracle'), { recursive: true });
  return {
    projectDir,
    cleanup() {
      try { rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ }
    },
  };
}

function pendingFile(projectDir) {
  return join(projectDir, '.construct', 'oracle', 'pending.jsonl');
}

function archiveFile(projectDir) {
  return join(projectDir, '.construct', 'oracle', 'pending-archive.jsonl');
}

function readJsonl(filePath) {
  try {
    return readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function seedRow({ id, dedupKey, kind, summary, status, queuedAt, count = 1 }) {
  return {
    id,
    kind,
    summary,
    classification: 'approve',
    status,
    signOff: {
      policyId: 'action-approval',
      approverWorkerProfileId: 'orchestrator',
    },
    context: { kind, summary },
    dedupKey,
    count,
    queuedAt,
    firstSeenAt: queuedAt,
    lastSeenAt: queuedAt,
  };
}

function seedBacklog(projectDir) {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    rows.push(seedRow({
      id: `oracle-tests-${i}`,
      dedupKey: 'oracle:tests',
      kind: 'worker-profile-review',
      summary: 'Re-run affected tests and refresh lastValidated for capabilities with changed implementation',
      status: 'pending',
      queuedAt: new Date(Date.now() - i * 1000).toISOString(),
    }));
  }
  for (let i = 0; i < 3; i++) {
    rows.push(seedRow({
      id: `oracle-violations-${i}`,
      dedupKey: 'oracle:violations',
      kind: 'worker-profile-review',
      summary: 'Review recent contract violations and route remediation to the owning Worker Profile',
      status: 'pending',
      queuedAt: new Date(Date.now() - i * 1000).toISOString(),
    }));
  }
  for (let i = 0; i < 2; i++) {
    rows.push(seedRow({
      id: `oracle-graph-${i}`,
      dedupKey: 'oracle:graph',
      kind: 'graph-rebuild',
      summary: 'Rebuild the dependency matrix to clear staleness',
      status: 'expired',
      queuedAt: new Date(Date.now() - i * 1000 - 8 * 24 * 60 * 60 * 1000).toISOString(),
    }));
  }
  rows.push(seedRow({
    id: 'oracle-approved-1',
    dedupKey: 'oracle:already-approved',
    kind: 'structure-cleanup-proposal',
    summary: 'Propose dead-code cleanup (no auto-delete)',
    status: 'approved',
    queuedAt: new Date().toISOString(),
  }));
  writeFileSync(pendingFile(projectDir), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return rows;
}

test('triagePending collapses duplicate dedupKeys to one survivor with an occurrenceCount', () => {
  const env = freshProject();
  try {
    const seeded = seedBacklog(env.projectDir);
    const eligibleSeeded = seeded.filter((r) => r.status !== 'approved');
    const result = triagePending(env.projectDir, { dryRun: false });

    // 3 dedupKeys eligible for collapse: tests/violations/graph. The
    // already-approved row is a real decision, not backlog noise — it is
    // left untouched in pending.jsonl and out of the triage's unique count.
    assert.equal(result.uniqueCount, 3);
    assert.ok(result.uniqueCount <= 10);

    const survivorByKey = new Map(result.survivors.map((s) => [s.dedupKey, s]));
    assert.equal(survivorByKey.get('oracle:tests').occurrenceCount, 5);
    assert.equal(survivorByKey.get('oracle:violations').occurrenceCount, 3);
    assert.equal(survivorByKey.get('oracle:graph').occurrenceCount, 2);
    assert.equal(survivorByKey.has('oracle:already-approved'), false);

    const totalOccurrences = result.survivors.reduce((sum, s) => sum + s.occurrenceCount, 0);
    assert.equal(totalOccurrences, eligibleSeeded.length);

    // Superseded rows: (5-1) + (3-1) + (2-1) = 7; the approved row has no duplicates.
    assert.equal(result.superseded, 7);

    const archived = readJsonl(archiveFile(env.projectDir));
    assert.equal(archived.length, 7);
    assert.ok(archived.every((row) => row.supersededBy && row.supersededAt && row.supersededReason));

    // Producer linkage surfaced on all three machine-recurring symptom kinds
    // (per the bead: re-run tests / review violations / rebuild matrix are
    // symptoms of r8wr.1 and r8wr.6, not decisions in their own right).
    assert.deepEqual(survivorByKey.get('oracle:tests').producerLinkage, ['construct-r8wr.6']);
    assert.deepEqual(survivorByKey.get('oracle:violations').producerLinkage, ['construct-r8wr.1']);
    assert.deepEqual(survivorByKey.get('oracle:graph').producerLinkage, ['construct-r8wr.6']);

    // The approved row was left untouched in pending.jsonl, not re-grouped or archived.
    const rewritten = readJsonl(pendingFile(env.projectDir));
    const approvedRow = rewritten.find((r) => r.id === 'oracle-approved-1');
    assert.ok(approvedRow, 'the already-approved row must remain in pending.jsonl');
    assert.equal(approvedRow.status, 'approved');
    assert.equal(rewritten.length, result.uniqueCount + 1, 'survivors + the untouched approved row');
  } finally {
    env.cleanup();
  }
});

test('triagePending --dry-run plans without mutating pending.jsonl', () => {
  const env = freshProject();
  try {
    seedBacklog(env.projectDir);
    const before = readFileSync(pendingFile(env.projectDir), 'utf8');

    const result = triagePending(env.projectDir, { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.uniqueCount, 3);

    const after = readFileSync(pendingFile(env.projectDir), 'utf8');
    assert.equal(after, before, 'dry-run must not mutate pending.jsonl');
    assert.deepEqual(readJsonl(archiveFile(env.projectDir)), [], 'dry-run must not write the archive');
  } finally {
    env.cleanup();
  }
});

test('a surviving pending row is still a valid approve target after triage', async () => {
  const env = freshProject();
  try {
    seedBacklog(env.projectDir);
    triagePending(env.projectDir, { dryRun: false });

    const survivor = listPending(env.projectDir, { includeExpired: true })
      .find((p) => p.dedupKey === 'oracle:tests');
    assert.ok(survivor, 'survivor for the pending dedupKey must remain in pending.jsonl');
    assert.equal(survivor.status, 'pending');

    const approval = await approvePending(env.projectDir, survivor.id, { execute: false });
    assert.equal(approval.ok, true);
    assert.equal(approval.action.status, 'approved');
  } finally {
    env.cleanup();
  }
});
