/**
 * tests/functional/embed-daemon-write-intent-drain.functional.test.mjs —
 * end-to-end proof that the embed daemon's 'write-intent-drain' job
 * (lib/embed/daemon.mjs, construct-4uxq0.9.5) actually calls
 * drainApprovedWriteIntents on its own cadence, closing the gap ADR-0094
 * described: drainApprovedWriteIntents (lib/writes/control-plane.mjs) was
 * implemented and tested but called by nothing in lib/ or bin/, leaving
 * `construct approvals approve <id>` as the only production drain path.
 *
 * Coverage here mirrors tests/functional/embed-daemon-inbox-loop.functional.test.mjs's
 * established pattern: a child process (sterile env, tests/helpers/sterile-env.mjs)
 * spawns tests/functional/fixtures/embed-daemon-write-intent-drain-tick-runner.mjs,
 * which constructs a real `EmbedDaemon`, calls the real `.start()`
 * (registering every scheduled job including 'write-intent-drain'), and lets
 * the scheduler run. 'write-intent-drain' is registered with
 * `{ runImmediately: true }` (lib/embed/daemon.mjs), so `Scheduler.start()`
 * fires its first tick synchronously-scheduled rather than waiting for the
 * 60s interval — the runner polls the durable ApprovalQueue record for that
 * tick's real effect instead of sleeping for the full interval.
 *
 * The parent test pre-seeds the ApprovalQueue's persistence file (outside
 * the daemon process) with one 'approved' atlassian-jira.issue record before
 * spawning the runner, and clears Jira credential env vars from the spawn
 * env (sterileSpawnEnv's allowlist already excludes them by construction,
 * asserted explicitly rather than merely assumed). The daemon wires
 * drainApprovedWriteIntents with no adapterFactories override, exactly as
 * production does, so real credential resolution runs and throws inside
 * executeApprovedWriteIntent with no network call — a genuine, deterministic
 * proof that the real drain code path executed, not a stub standing in for
 * it, and that the durable record left its pre-seeded 'approved' state
 * carrying a lease-acquired/failure trail only the real
 * drainApprovedWriteIntents -> ApprovalQueue.acquireLease/releaseLease flow
 * produces.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(__dirname, 'fixtures', 'embed-daemon-write-intent-drain-tick-runner.mjs');

const dirs = [];
after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function freshProject() {
  const root = mkdtempSync(join(tmpdir(), 'cx-embed-daemon-drain-'));
  dirs.push(root);
  mkdirSync(join(root, '.construct'), { recursive: true });
  writeFileSync(join(root, '.construct', 'context.md'), '# test project\n');
  return root;
}

function runDaemonTick(root, persistPath, approvalId, timeoutMs = 15_000) {
  const env = sterileSpawnEnv({
    HOME: root,
    USERPROFILE: root,
    CX_HOME_OVERRIDE: root,
    CX_ROOT_DIR: root,
    QUEUE_PERSIST_PATH: persistPath,
    APPROVAL_ID: approvalId,
    TICK_TIMEOUT_MS: String(timeoutMs),
    CX_INBOX_LIVE_WATCH: 'off',
    CONSTRUCT_EMBED_ROADMAP_ENABLED: '0',
  });

  // sterileSpawnEnv's allowlist excludes JIRA_URL/JIRA_EMAIL/JIRA_TOKEN by
  // construction — assert it rather than assume it, since the whole test's
  // determinism (a synchronous, network-free credential-resolution throw)
  // depends on this.
  assert.equal(env.JIRA_URL, undefined);
  assert.equal(env.JIRA_TOKEN, undefined);

  return spawnSync(process.execPath, [RUNNER], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: timeoutMs + 10_000,
  });
}

test('the real EmbedDaemon write-intent-drain job drains an approved record on its first tick', () => {
  const root = freshProject();
  const persistPath = join(root, 'approvals', 'queue.jsonl');

  const seedQueue = new ApprovalQueue({ persistPath });
  const record = seedQueue.enqueue({
    tool: 'atlassian-jira.issue',
    args: { project: 'PROJ', issueType: 'Task', summary: 'Drained by the daemon job' },
    surface: 'test-seed',
    requestedBy: { userId: 'test-seed' },
  });
  seedQueue.approve(record.approvalId, { decidedBy: { userId: 'test-operator' } });
  assert.equal(seedQueue.getById(record.approvalId).state, 'approved');

  const res = runDaemonTick(root, persistPath, record.approvalId);
  assert.equal(res.status, 0, `runner exited non-zero — stdout: ${res.stdout}\nstderr: ${res.stderr}`);

  const result = JSON.parse(res.stdout.trim().split('\n').pop());
  assert.equal(result.ok, true, `write-intent-drain tick did not act on the seeded record: ${JSON.stringify(result)}`);

  // Real, credential-free proof: the daemon's real DEFAULT_ADAPTER_FACTORIES
  // resolution threw on missing JIRA_URL, drainApprovedWriteIntents caught
  // the throw and released the lease with outcome 'failure', which
  // ApprovalQueue.releaseLease returns to 'approved' with the reason
  // recorded — none of that trail exists unless the real job ran.
  assert.equal(result.record.state, 'approved', 'a credential failure releases back to approved, not executed');
  assert.match(result.record.lastLeaseFailureReason, /Jira transport requires JIRA_URL/);
  assert.equal(result.record.leaseWorkerId, null, 'the lease must be released, not left held after the failed attempt');

  // Confirm on-disk state independently of the runner's own report.
  const verifyQueue = new ApprovalQueue({ persistPath });
  const onDisk = verifyQueue.getById(record.approvalId);
  assert.equal(onDisk.state, 'approved');
  assert.match(onDisk.lastLeaseFailureReason, /Jira transport requires JIRA_URL/);
});
