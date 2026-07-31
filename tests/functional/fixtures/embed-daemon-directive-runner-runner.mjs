/**
 * tests/functional/fixtures/embed-daemon-directive-runner-runner.mjs —
 * child process driver for embed-daemon-directive-runner.functional.test.mjs
 * (WS-B3: the "directive-runner" job).
 *
 * Boots a real EmbedDaemon against a construct.config.json carrying two
 * directives — one valid and due, one referencing an unknown specialist —
 * and polls for: a 'directive' + 'due' tagged observation for the valid
 * one, a due-tracker state file recording its lastRunAt, and a degradation
 * ledger entry for the invalid one. The job is registered with
 * `runImmediately: true`, so it fires on the same tick as `.start()`.
 *
 * Reads CONSTRUCT_ROOT_DIR and TICK_TIMEOUT_MS from env.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EmbedDaemon } from '../../../lib/embed/daemon.mjs';
import { EMPTY_CONFIG } from '../../../lib/embed/config.mjs';
import { readDirectiveState } from '../../../lib/directives/due-tracker.mjs';
import { listDegradations } from '../../../lib/embed/degradation.mjs';

const rootDir = process.env.CONSTRUCT_ROOT_DIR;
const timeoutMs = Number(process.env.TICK_TIMEOUT_MS || 15_000);
const pollIntervalMs = 150;

function readJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

function findArtifacts() {
  const observations = readJsonFiles(join(rootDir, '.construct', 'observations'))
    .filter((o) => o.tags?.includes('directive') && o.tags?.includes('due'));
  const state = readDirectiveState(rootDir, 'jira-weekly-summary');
  const degradations = listDegradations(rootDir).filter((d) => d.job === 'directive-runner');
  return { observations, state, degradations };
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
  while ((artifacts.observations.length === 0 || !artifacts.state.lastRunAt || artifacts.degradations.length === 0) && Date.now() < deadline) {
    await sleep(pollIntervalMs);
    artifacts = findArtifacts();
  }

  daemon.stop();

  const ok = artifacts.observations.length > 0 && !!artifacts.state.lastRunAt && artifacts.degradations.length > 0;

  process.stdout.write(JSON.stringify({ ok, ...artifacts }) + '\n');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: err?.stack || String(err) }) + '\n');
  process.exit(1);
});
