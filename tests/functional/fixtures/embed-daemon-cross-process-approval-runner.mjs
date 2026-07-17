/**
 * tests/functional/fixtures/embed-daemon-cross-process-approval-runner.mjs —
 * child process driver for embed-daemon-cross-process-approval.functional.test.mjs.
 *
 * Boots the real EmbedDaemon (lib/embed/daemon.mjs) with NO explicit
 * persistPath override — the production path (lib/embed/worker.mjs never
 * passes one) — so the daemon's own default resolution
 * (ApprovalQueue.resolvePersistPath(rootDir, deploymentMode)) is what is
 * under test, not an injected path. Shortly after the daemon's first
 * (runImmediately) write-intent-drain tick, this script opens a SEPARATE
 * ApprovalQueue instance at the same resolved path — simulating a human
 * running `construct approvals approve <id>` in another terminal — and
 * approves the pre-seeded record, then waits for the daemon's next
 * write-intent-drain tick (a short custom interval) to notice and drain it.
 *
 * No network: JIRA_URL/JIRA_EMAIL/JIRA_TOKEN are absent from the sterile
 * spawn env, so the governed Jira transport throws a synchronous AuthError —
 * a durable, deterministic failure outcome that still proves the record was
 * seen and an execution attempt was made.
 *
 * Reads CX_ROOT_DIR and TICK_TIMEOUT_MS from env. Prints one JSON line to
 * stdout on success or failure and exits 0/1 accordingly.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { EmbedDaemon } from '../../../lib/embed/daemon.mjs';
import { EMPTY_CONFIG } from '../../../lib/embed/config.mjs';
import { ApprovalQueue } from '../../../lib/embed/approval-queue.mjs';
import { getDeploymentMode } from '../../../lib/deployment-mode.mjs';

const rootDir = process.env.CX_ROOT_DIR;
const timeoutMs = Number(process.env.TICK_TIMEOUT_MS || 15_000);
const pollIntervalMs = 100;

// Mirrors exactly what lib/cli/approvals.mjs resolves — the point of this
// test is that the daemon (constructed with no persistPath override) lands
// on this SAME path independently.

const deploymentMode = getDeploymentMode(process.env, { cwd: rootDir });
const persistPath = ApprovalQueue.resolvePersistPath(rootDir, deploymentMode);

function readJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

function findArtifacts() {
  const reader = new ApprovalQueue({ persistPath });
  const record = reader.list().find((r) => r.toolCall?.tool === 'atlassian-jira.comment') ?? null;
  const observations = readJsonFiles(join(rootDir, '.construct', 'observations'))
    .filter((o) => o.tags?.includes('write-intent-drain'));
  return { record, observations };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Seed a pending record BEFORE the daemon starts, at the same resolved
  // path — an intent enqueued by an earlier daemon tick or an MCP call, not
  // yet decided.
  const seedQueue = new ApprovalQueue({ persistPath });
  const seeded = seedQueue.enqueue({
    tool: 'atlassian-jira.comment',
    args: { issueKey: 'OPS-1', body: 'cross-process approval test' },
    surface: 'test',
  });

  // No persistPath passed — the exact production gap under test.

  const daemon = new EmbedDaemon({
    config: EMPTY_CONFIG,
    rootDir,
    workspaceDir: rootDir,
    env: process.env,
  });

  await daemon.start();

  // Give the first (runImmediately) tick a moment to run and confirm it
  // left the record untouched (still awaiting_approval — nothing auto-grants
  // it), then approve it from an entirely separate queue instance, exactly
  // as a human's `construct approvals approve` invocation would.
  await sleep(250);
  const approverQueue = new ApprovalQueue({ persistPath });
  approverQueue.approve(seeded.approvalId, { decidedBy: { userId: 'test-operator' } });

  // A failed execution under the lease model (ADR-0089) releases the lease
  // back to 'approved' and stamps lastLeaseFailureReason — that durable
  // marker, not main's retired executionAttempts counter, is the proof the
  // drain reached the adapter and recorded the outcome.
  const deadline = Date.now() + timeoutMs;
  let artifacts = findArtifacts();
  while ((!artifacts.record || !artifacts.record.lastLeaseFailureReason || artifacts.observations.length === 0) && Date.now() < deadline) {
    await sleep(pollIntervalMs);
    artifacts = findArtifacts();
  }

  daemon.stop();

  const ok = !!artifacts.record
    && artifacts.record.state === 'approved'
    && artifacts.record.decidedBy?.userId === 'test-operator'
    && !!artifacts.record.lastLeaseFailureReason
    && artifacts.observations.length > 0;

  process.stdout.write(JSON.stringify({
    ok,
    resolvedPersistPath: persistPath,
    record: artifacts.record,
    observations: artifacts.observations,
  }) + '\n');

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: err?.stack || String(err) }) + '\n');
  process.exit(1);
});
