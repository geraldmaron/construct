/**
 * tests/functional/fixtures/embed-daemon-write-drain-runner.mjs — child
 * process driver for embed-daemon-write-drain.functional.test.mjs
 * (construct-p4cba.3, WS-B2).
 *
 * Boots the real EmbedDaemon (lib/embed/daemon.mjs) against a pre-seeded
 * ApprovalQueue (one `jira.comment` write intent, still `awaiting_approval`)
 * and a construct.config.json carrying `writes.policy` for that tool set to
 * 'auto'. Job "write-intent-drain" runs with `runImmediately: true`, so
 * `Scheduler.start()` fires it on the same tick as `.start()` — this script
 * polls the approval-queue JSONL file and the observation store for that
 * tick's durable output instead of sleeping for the job's full interval.
 *
 * No network: JIRA_URL/JIRA_EMAIL/JIRA_TOKEN are deliberately absent from the
 * sterile spawn env (tests/helpers/sterile-env.mjs's allowlist never carries
 * them), so lib/providers/contract/adapters/jira/transport.mjs's
 * createJiraTransport() throws a synchronous AuthError the moment the
 * governed adapter factory is resolved — proving the whole pipeline (config
 * read -> auto-grant -> drain -> adapter resolution -> durable outcome
 * recording -> observation write) without needing a live Jira instance or a
 * successful write.
 *
 * Reads CONSTRUCT_ROOT_DIR (project root) and TICK_TIMEOUT_MS from env. Prints one
 * JSON line to stdout on success or failure and exits 0/1 accordingly.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EmbedDaemon } from '../../../lib/embed/daemon.mjs';
import { EMPTY_CONFIG } from '../../../lib/embed/config.mjs';
import { ApprovalQueue } from '../../../lib/embed/approval-queue.mjs';

const rootDir = process.env.CONSTRUCT_ROOT_DIR;
const persistPath = process.env.CONSTRUCT_APPROVAL_QUEUE_PATH;
const timeoutMs = Number(process.env.TICK_TIMEOUT_MS || 15_000);
const pollIntervalMs = 150;

function readJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

function findArtifacts() {
  const queue = new ApprovalQueue({ persistPath });
  const record = queue.list().find((r) => r.toolCall?.tool === 'jira.comment') ?? null;
  const observations = readJsonFiles(join(rootDir, '.construct', 'observations'))
    .filter((o) => o.tags?.includes('write-intent-drain'));
  return { record, observations };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const daemon = new EmbedDaemon({
    config: EMPTY_CONFIG,
    rootDir,
    workspaceDir: rootDir,
    env: process.env,
    persistPath,
  });

  await daemon.start();

  const deadline = Date.now() + timeoutMs;
  let artifacts = findArtifacts();
  while ((!artifacts.record || artifacts.record.executionAttempts < 1 || artifacts.observations.length === 0) && Date.now() < deadline) {
    await sleep(pollIntervalMs);
    artifacts = findArtifacts();
  }

  daemon.stop();

  const ok = !!artifacts.record
    && artifacts.record.state === 'approved'
    && artifacts.record.executionAttempts >= 1
    && artifacts.observations.length > 0;

  process.stdout.write(JSON.stringify({
    ok,
    record: artifacts.record,
    observations: artifacts.observations,
  }) + '\n');

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: err?.stack || String(err) }) + '\n');
  process.exit(1);
});
