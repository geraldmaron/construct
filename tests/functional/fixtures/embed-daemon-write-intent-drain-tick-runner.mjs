/**
 * tests/functional/fixtures/embed-daemon-write-intent-drain-tick-runner.mjs —
 * child process driver for embed-daemon-write-intent-drain.functional.test.mjs
 * (construct-4uxq0.9.5).
 *
 * Boots the real EmbedDaemon (lib/embed/daemon.mjs), which registers the
 * 'write-intent-drain' job with `runImmediately: true` on start(), and polls
 * the durable ApprovalQueue record the parent test pre-seeded (via
 * QUEUE_PERSIST_PATH + APPROVAL_ID) until that job's real
 * drainApprovedWriteIntents() call has visibly acted on it — proven by the
 * record leaving the 'approved' state it started in — or a bounded timeout
 * elapses. No adapterFactories override reaches drainApprovedWriteIntents
 * here: the daemon wires it with only { rootDir }, exactly as production
 * does, so a real DEFAULT_ADAPTER_FACTORIES resolution runs. With Jira
 * credential env vars cleared by the parent test, that resolution throws
 * deterministically inside executeApprovedWriteIntent (no network), which
 * the drain's lease-release-on-failure path returns to 'approved' with
 * `lastLeaseFailureReason` set — real, observable proof this tick actually
 * ran the real control-plane code, not a stub.
 *
 * Reads CX_ROOT_DIR, QUEUE_PERSIST_PATH, APPROVAL_ID, and TICK_TIMEOUT_MS
 * from env. Prints one JSON line to stdout on success or failure and exits
 * 0/1 accordingly. Config carries zero sources so ProviderRegistry.fromEnv()
 * resolves only credential-free providers — no network from the daemon's
 * other jobs either.
 */

import { EmbedDaemon } from '../../../lib/embed/daemon.mjs';
import { EMPTY_CONFIG } from '../../../lib/embed/config.mjs';
import { ApprovalQueue } from '../../../lib/embed/approval-queue.mjs';

const rootDir = process.env.CX_ROOT_DIR;
const persistPath = process.env.QUEUE_PERSIST_PATH;
const approvalId = process.env.APPROVAL_ID;
const timeoutMs = Number(process.env.TICK_TIMEOUT_MS || 15_000);
const pollIntervalMs = 150;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const daemon = new EmbedDaemon({
    config: EMPTY_CONFIG,
    rootDir,
    workspaceDir: rootDir,
    persistPath,
    env: process.env,
  });

  await daemon.start();

  const pollQueue = new ApprovalQueue({ persistPath });
  const deadline = Date.now() + timeoutMs;
  let record = pollQueue.getById(approvalId);
  while (record?.state === 'approved' && !record.lastLeaseFailureReason && Date.now() < deadline) {
    await sleep(pollIntervalMs);
    record = pollQueue.getById(approvalId);
  }

  daemon.stop();

  const ok = Boolean(record) && (record.state === 'executed' || Boolean(record.lastLeaseFailureReason));

  process.stdout.write(JSON.stringify({ ok, record }) + '\n');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: err?.stack || String(err) }) + '\n');
  process.exit(1);
});
