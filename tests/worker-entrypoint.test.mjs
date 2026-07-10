/**
 * tests/worker-entrypoint.test.mjs — worker loop contract.
 *
 * Drives runWorkerLoop with an injected queue stub so the test runs
 * without Docker and without a live Postgres. Pins: claims drain the
 * queue in order, passing jobs are markProcessed'd with worker
 * identity, failed/timed-out jobs are markSkipped'd with a structured
 * reason, the idle timeout terminates the loop, and stopAfter stops
 * after N drained items.
 *
 * runWorkerLoop writes trace events through the machine-scoped state root
 * (ADR-0066), keyed by a hash of projectRoot — so CX_HOME_OVERRIDE is pinned
 * per test to keep that write off the real developer machine's $HOME.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runWorkerLoop } from '../lib/worker/entrypoint.mjs';

let projectRoot;
let originalCwd;
let homeOverride;
let prevHomeOverride;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-worker-loop-'));
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-worker-loop-home-'));
  originalCwd = process.cwd();
  prevHomeOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = homeOverride;
  process.chdir(projectRoot);
  // artifactsDir() resolves the machine-scoped state root (ADR-0066) via
  // CX_HOME_OVERRIDE read in-process, not via rootDir — unpinned, writes
  // land in the real developer machine's ~/.construct/projects.
  prevHomeOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = projectRoot;
});

afterEach(() => {
  process.chdir(originalCwd);
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(homeOverride, { recursive: true, force: true });
});

/**
 * Tiny in-memory queue satisfying the IntakeQueue contract for the
 * worker loop (claim / markProcessed / markSkipped). Scripted packets
 * are claimed in order; the test asserts the recorded calls afterward.
 */
function buildStubQueue(scriptedPackets) {
  const queue = scriptedPackets.slice();
  const processed = [];
  const skipped = [];
  return {
    handle: {
      claim: async () => queue.shift() || null,
      markProcessed: async (id, meta) => { processed.push({ id, meta }); return { id }; },
      markSkipped: async (id, meta) => { skipped.push({ id, meta }); return { id }; },
    },
    processed,
    skipped,
  };
}

describe('runWorkerLoop', () => {
  it('exits when the queue stays empty past the idle timeout', async () => {
    const { handle } = buildStubQueue([]);
    const summary = await runWorkerLoop({
      rootDir: projectRoot,
      workspace: projectRoot,
      project: 'test',
      queue: handle,
      idleTimeoutSeconds: 0,
      pollIntervalMs: 10,
    });
    assert.equal(summary.processed, 0);
    assert.equal(summary.skipped, 0);
    assert.ok(summary.workerName);
  });

  it('marks a passing command processed with the worker name and duration note', async () => {
    const { handle, processed, skipped } = buildStubQueue([
      { id: 'packet-1', intake: { project: 'test' }, workerCommand: 'echo ok' },
    ]);
    const summary = await runWorkerLoop({
      rootDir: projectRoot,
      workspace: projectRoot,
      project: 'test',
      queue: handle,
      idleTimeoutSeconds: 0,
      pollIntervalMs: 10,
      stopAfter: 1,
    });
    assert.equal(summary.processed, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(processed.length, 1);
    assert.equal(processed[0].id, 'packet-1');
    assert.match(processed[0].meta.processedBy, /worker-/);
    assert.match(processed[0].meta.notes, /^passed in/);
    assert.equal(skipped.length, 0);
  });

  it('marks a failing command skipped with a structured reason naming exit code', async () => {
    const { handle, processed, skipped } = buildStubQueue([
      { id: 'fail-1', intake: { project: 'test' }, workerCommand: 'exit 7' },
    ]);
    await runWorkerLoop({
      rootDir: projectRoot,
      workspace: projectRoot,
      project: 'test',
      queue: handle,
      idleTimeoutSeconds: 0,
      pollIntervalMs: 10,
      stopAfter: 1,
    });
    assert.equal(processed.length, 0);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].meta.reason, /exit code 7/);
    assert.match(skipped[0].meta.reason, /stdout=/);
    assert.match(skipped[0].meta.reason, /stderr=/);
  });

  it('marks a timed-out command skipped with timeout in the reason', async () => {
    const { handle, skipped } = buildStubQueue([
      { id: 'slow-1', intake: { project: 'test' }, workerCommand: 'sleep 5', timeoutSeconds: 1 },
    ]);
    await runWorkerLoop({
      rootDir: projectRoot,
      workspace: projectRoot,
      project: 'test',
      queue: handle,
      idleTimeoutSeconds: 0,
      pollIntervalMs: 10,
      stopAfter: 1,
    });
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].meta.reason, /timed out/);
  });

  it('drains multiple claims in order and respects stopAfter', async () => {
    const { handle, processed } = buildStubQueue([
      { id: 'p1', intake: { project: 'test' }, workerCommand: 'echo one' },
      { id: 'p2', intake: { project: 'test' }, workerCommand: 'echo two' },
      { id: 'p3', intake: { project: 'test' }, workerCommand: 'echo three' },
    ]);
    const summary = await runWorkerLoop({
      rootDir: projectRoot,
      workspace: projectRoot,
      project: 'test',
      queue: handle,
      idleTimeoutSeconds: 0,
      pollIntervalMs: 10,
      stopAfter: 2,
    });
    assert.equal(summary.processed, 2);
    assert.deepEqual(processed.map((p) => p.id), ['p1', 'p2']);
  });
});
