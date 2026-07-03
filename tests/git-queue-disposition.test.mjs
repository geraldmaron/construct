/**
 * tests/git-queue-disposition.test.mjs
 *
 * Tests for GitIntakeQueue disposition behaviour per the queue provider-kind
 * reframe (construct-9oi4.7.11, supersedes the ADR-0051 / A1 framing):
 *   - claim() emits a warning when push fails, does NOT throw
 *   - a failed push is reported as a typed NON-DURABLE disposition on the
 *     returned claim — it is never ratified as a durable claim
 *   - a successful push is reported as durable
 *   - markSkipped() moves the file locally without pushing
 *
 * Uses the _exec injection seam added to GitIntakeQueue so no
 * module-level monkey-patching is needed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { GitIntakeQueue } from '../lib/intake/git-queue.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cx-git-queue-test-'));
}

function seedPendingItem(rootDir, id = 'test-item-001') {
  const pendingDir = path.join(rootDir, '.cx', 'team-inbox', 'pending');
  fs.mkdirSync(pendingDir, { recursive: true });
  const filePath = path.join(pendingDir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    id,
    status: 'pending',
    createdAt: new Date().toISOString(),
    intake: { sourcePath: 'test.md' },
    triage: {},
  }, null, 2));
  return id;
}

/** Build a fake _exec that throws on 'git push', is a no-op otherwise. */
function makeFakeExec({ throwOn = 'push', calls = [] } = {}) {
  return function fakeExec(cmd, opts) {
    calls.push(cmd);
    if (throwOn && cmd.includes(throwOn)) {
      throw new Error(`simulated ${throwOn} failure`);
    }
    // pull, add, commit — no-op
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitIntakeQueue — disposition (LMCP-G7)', () => {
  let rootDir;

  beforeEach(() => {
    rootDir = makeTmpRoot();
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // claim() — push failure behaviour
  // -------------------------------------------------------------------------

  it('claim() does NOT throw when push fails', async () => {
    seedPendingItem(rootDir, 'task-push-fail');

    const calls = [];
    const q = new GitIntakeQueue({
      project: 'test',
      rootDir,
      _exec: makeFakeExec({ throwOn: 'push', calls }),
    });

    let result;
    await assert.doesNotReject(async () => {
      result = await q.claim({ claimedBy: 'agent-1' });
    });

    assert.ok(result, 'claim() should return the claimed item even when push fails');
    assert.equal(result.status, 'claimed');
    assert.ok(calls.some(c => c.includes('push')), 'push should have been attempted');
  });

  it('claim() emits a console.warn when push fails', async () => {
    seedPendingItem(rootDir, 'task-warn-check');

    const q = new GitIntakeQueue({
      project: 'test',
      rootDir,
      _exec: makeFakeExec({ throwOn: 'push' }),
    });

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      await q.claim({ claimedBy: 'agent-2' });
    } finally {
      console.warn = origWarn;
    }

    const pushWarn = warnings.find(w => w.includes('push failed'));
    assert.ok(pushWarn, `expected a push-failed warning, got: ${JSON.stringify(warnings)}`);
    assert.ok(pushWarn.includes('agent-2'), 'warning should mention the claimedBy value');
  });

  it('claim() returns claimed data with correct metadata even when push fails', async () => {
    seedPendingItem(rootDir, 'task-meta-check');

    const q = new GitIntakeQueue({
      project: 'test',
      rootDir,
      _exec: makeFakeExec({ throwOn: 'push' }),
    });

    const result = await q.claim({ claimedBy: 'agent-3' });

    assert.ok(result);
    assert.equal(result.claimedBy, 'agent-3');
    assert.equal(result.status, 'claimed');
    assert.ok(result.claimedAt, 'claimedAt should be set');

    // A failed push must be reported as a typed non-durable disposition, never
    // ratified as a durable claim.
    assert.equal(result.durable, false, 'a failed push must not be ratified as durable');
    assert.equal(result.disposition, 'local-only');
    assert.ok(result.dispositionReason, 'the non-durable reason should be carried');

    // File should be in the claimed directory, not pending.
    const claimedFile = path.join(
      rootDir, '.cx', 'team-inbox', 'claimed', 'agent-3', `${result.id}.json`
    );
    assert.ok(fs.existsSync(claimedFile), 'claimed file should exist locally');

    // File must be absent from pending after a successful claim.
    const pendingFile = path.join(rootDir, '.cx', 'team-inbox', 'pending', `${result.id}.json`);
    assert.equal(fs.existsSync(pendingFile), false, 'file should have been moved from pending');
  });

  it('claim() reports a durable disposition when the push succeeds', async () => {
    seedPendingItem(rootDir, 'task-durable-check');

    // No throwOn — every exec (pull, add, commit, push) is a no-op success.
    const q = new GitIntakeQueue({
      project: 'test',
      rootDir,
      _exec: makeFakeExec({ throwOn: null }),
    });

    const result = await q.claim({ claimedBy: 'agent-4' });

    assert.ok(result);
    assert.equal(result.status, 'claimed');
    assert.equal(result.durable, true, 'a successful push must be reported as durable');
    assert.equal(result.disposition, 'pushed');
  });

  // -------------------------------------------------------------------------
  // markSkipped() — local-only, no push
  // -------------------------------------------------------------------------

  it('markSkipped() moves the item to skipped without any git exec calls', async () => {
    seedPendingItem(rootDir, 'task-skip-001');

    const calls = [];
    // _exec should never be called by markSkipped — pass a stub that records calls.
    const q = new GitIntakeQueue({
      project: 'test',
      rootDir,
      _exec: (cmd) => { calls.push(cmd); },
    });

    const result = await q.markSkipped('task-skip-001');

    assert.equal(result.id, 'task-skip-001');
    assert.ok(result.skippedAt, 'skippedAt should be set');
    assert.equal(calls.length, 0, 'markSkipped must not call _exec (no push)');

    // File should be in the skipped directory.
    const skippedFile = path.join(rootDir, '.cx', 'team-inbox', 'skipped', 'task-skip-001.json');
    assert.ok(fs.existsSync(skippedFile), 'skipped file should exist');

    const skippedData = JSON.parse(fs.readFileSync(skippedFile, 'utf8'));
    assert.equal(skippedData.status, 'skipped');

    // Pending file should be gone.
    const pendingFile = path.join(rootDir, '.cx', 'team-inbox', 'pending', 'task-skip-001.json');
    assert.equal(fs.existsSync(pendingFile), false, 'pending file should have been moved');
  });

  it('markSkipped() throws if the issueId does not exist', async () => {
    const q = new GitIntakeQueue({ project: 'test', rootDir, _exec: () => {} });

    await assert.rejects(
      () => q.markSkipped('nonexistent-id'),
      /markSkipped: no entry nonexistent-id found/,
    );
  });

  it('markSkipped() throws if issueId is falsy', async () => {
    const q = new GitIntakeQueue({ project: 'test', rootDir, _exec: () => {} });

    await assert.rejects(
      () => q.markSkipped(''),
      /markSkipped: issueId is required/,
    );
  });
});
