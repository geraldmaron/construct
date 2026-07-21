/**
 * tests/functional/fixtures/embed-daemon-roadmap-slack-proposal-runner.mjs —
 * child process driver for embed-daemon-roadmap-slack-proposal.functional.test.mjs.
 *
 * Boots the real EmbedDaemon (lib/embed/daemon.mjs) with a short custom
 * interval for Job 10 (roadmap) via CONSTRUCT_EMBED_ROADMAP_JOB_INTERVAL_MS
 * so the test does not wait out the hour-long production default, and a
 * Slack channel configured via SLACK_CHANNELS. Polls the daemon's own
 * (default-resolved, no persistPath override) ApprovalQueue for the
 * `slack.message` writeIntent Job 10 proposes, and the observation store for
 * the accompanying 'roadmap' observation.
 *
 * No network: the write intent is only ever enqueued here, never drained —
 * proving the proposal is made is the goal, not that it gets sent.
 *
 * Reads CONSTRUCT_ROOT_DIR and TICK_TIMEOUT_MS from env. Prints one JSON line to
 * stdout on success or failure and exits 0/1 accordingly.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EmbedDaemon } from '../../../lib/embed/daemon.mjs';
import { EMPTY_CONFIG } from '../../../lib/embed/config.mjs';
import { ApprovalQueue } from '../../../lib/embed/approval-queue.mjs';
import { getDeploymentMode } from '../../../lib/deployment-mode.mjs';

const rootDir = process.env.CONSTRUCT_ROOT_DIR;
const timeoutMs = Number(process.env.TICK_TIMEOUT_MS || 15_000);
const pollIntervalMs = 100;

const deploymentMode = getDeploymentMode(process.env, { cwd: rootDir });
const persistPath = ApprovalQueue.resolvePersistPath(rootDir, deploymentMode);

function readJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

function findArtifacts() {
  const queue = new ApprovalQueue({ persistPath });
  const record = queue.list().find((r) => r.toolCall?.tool === 'slack.message') ?? null;
  const observations = readJsonFiles(join(rootDir, '.construct', 'observations'))
    .filter((o) => o.tags?.includes('roadmap'));
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
  });

  await daemon.start();

  const deadline = Date.now() + timeoutMs;
  let artifacts = findArtifacts();
  while ((!artifacts.record || artifacts.observations.length === 0) && Date.now() < deadline) {
    await sleep(pollIntervalMs);
    artifacts = findArtifacts();
  }

  daemon.stop();

  const ok = !!artifacts.record
    && artifacts.record.state === 'awaiting_approval'
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
