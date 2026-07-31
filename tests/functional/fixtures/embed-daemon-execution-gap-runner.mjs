/**
 * tests/functional/fixtures/embed-daemon-execution-gap-runner.mjs — child
 * process driver for embed-daemon-execution-gap.functional.test.mjs
 * (WS-B3: Job 12 "execution-gap" rebound to the governed
 * write tree).
 *
 * Before this bead, Job 12 called `jiraProvider.search(jql, {maxResults})`
 * and `jiraProvider.write({...})` on the embed READ-tree provider
 * (lib/embed/providers/jira.mjs), which implements neither method — every
 * run threw and was swallowed by the job's own try/catch, so no gap was
 * ever detected or proposed. (A second, independent bug on the same path —
 * `searchObservations` called without `await` — meant the function never
 * even reached that far; both are fixed in this pass.)
 *
 * Seeds one "strategy doc" observation with no matching Jira ticket, then
 * boots a real EmbedDaemon with an injected fake registry exposing only a
 * credential-free `jira.read()` (Job 12 has `runImmediately: true`, so it
 * fires on the same tick as `.start()`), and polls for the resulting
 * writeIntent (an 'awaiting_approval' record for tool "jira.issue") plus
 * the execution-gap observation.
 *
 * Reads CONSTRUCT_ROOT_DIR and TICK_TIMEOUT_MS from env.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EmbedDaemon } from '../../../lib/embed/daemon.mjs';
import { EMPTY_CONFIG } from '../../../lib/embed/config.mjs';
import { ApprovalQueue } from '../../../lib/embed/approval-queue.mjs';
import { addObservation } from '../../../lib/observation-store.mjs';

const rootDir = process.env.CONSTRUCT_ROOT_DIR;
const timeoutMs = Number(process.env.TICK_TIMEOUT_MS || 15_000);
const pollIntervalMs = 150;

function readJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

function fakeRegistry() {
  return {
    get(id) {
      if (id !== 'jira') return null;
      return {
        async read(ref, opts = {}) {
          if (ref !== 'issues') return [];
          return []; // no existing tickets — every strategy doc becomes a gap
        },
      };
    },
  };
}

function findArtifacts(persistPath) {
  const queue = new ApprovalQueue({ persistPath });
  const proposedIssue = queue.list().find((r) => r.toolCall?.tool === 'jira.issue') ?? null;
  const observations = readJsonFiles(join(rootDir, '.construct', 'observations'))
    .filter((o) => o.tags?.includes('execution-gap'));
  return { proposedIssue, observations };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await addObservation(rootDir, {
    role: 'construct',
    category: 'insight',
    summary: 'PRD: launch the quasar-widget self-service flow',
    content: 'Strategy doc describing the quasar-widget self-service flow requirements.',
    tags: ['prd'],
    source: 'test-fixture',
  });

  const persistPath = join(rootDir, '.construct', 'approvals', 'queue.jsonl');
  const daemon = new EmbedDaemon({
    config: EMPTY_CONFIG,
    registry: fakeRegistry(),
    rootDir,
    workspaceDir: rootDir,
    env: process.env,
    persistPath,
  });

  await daemon.start();

  const deadline = Date.now() + timeoutMs;
  let artifacts = findArtifacts(persistPath);
  while ((!artifacts.proposedIssue || artifacts.observations.length === 0) && Date.now() < deadline) {
    await sleep(pollIntervalMs);
    artifacts = findArtifacts(persistPath);
  }

  daemon.stop();

  const ok = !!artifacts.proposedIssue
    && artifacts.proposedIssue.state === 'awaiting_approval'
    && artifacts.observations.length > 0;

  process.stdout.write(JSON.stringify({
    ok,
    proposedIssue: artifacts.proposedIssue,
    observations: artifacts.observations,
  }) + '\n');

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: err?.stack || String(err) }) + '\n');
  process.exit(1);
});
