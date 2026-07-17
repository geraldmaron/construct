/**
 * tests/functional/embed-daemon-roadmap-slack-proposal.functional.test.mjs —
 * end-to-end proof of daemon Job 10's (roadmap) Slack write-intent proposal,
 * the daemon-side half of construct-p4cba.4's Job 10 rebound (WS-B3): a
 * generated roadmap summary is proposed to Slack as a governed writeIntent
 * on the approval queue, never posted directly.
 *
 * Job 10 registers with no `runImmediately` and a one-hour interval — an
 * env-overridable interval (CONSTRUCT_EMBED_ROADMAP_JOB_INTERVAL_MS,
 * matching CONSTRUCT_WRITE_DRAIN_INTERVAL_MS's existing convention) lets a
 * test drive a real tick quickly without touching production timing (the
 * one-hour default holds whenever the env var is unset).
 *
 * Spawns a real EmbedDaemon with a Slack channel configured
 * (SLACK_CHANNELS) and asserts, within one short-interval tick:
 *   - a `slack.message` writeIntent lands on the approval queue, awaiting
 *     approval (never sent directly — Job 10 only ever enqueues)
 *   - an observation tagged 'roadmap' is recorded, independent of whether
 *     a channel was configured at all
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(__dirname, 'fixtures', 'embed-daemon-roadmap-slack-proposal-runner.mjs');

const dirs = [];
after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function freshProject() {
  const root = mkdtempSync(join(tmpdir(), 'cx-embed-daemon-roadmap-slack-'));
  dirs.push(root);
  mkdirSync(join(root, '.construct'), { recursive: true });
  writeFileSync(join(root, '.construct', 'context.md'), '# test project\n');
  writeFileSync(join(root, 'construct.config.json'), JSON.stringify({ version: 1 }, null, 2));
  return root;
}

test('Job 10 proposes a Slack write-intent for the generated roadmap within one tick, never posting directly', () => {
  const root = freshProject();
  const timeoutMs = 15_000;

  const env = sterileSpawnEnv({
    HOME: root,
    USERPROFILE: root,
    CX_HOME_OVERRIDE: root,
    CX_ROOT_DIR: root,
    TICK_TIMEOUT_MS: String(timeoutMs),
    CONSTRUCT_EMBED_ROADMAP_JOB_INTERVAL_MS: '250',
    SLACK_CHANNELS: '#roadmap-updates',
    CONSTRUCT_EMBEDDING_MODEL: 'hashing',
    CX_INBOX_LIVE_WATCH: 'off',
    CONSTRUCT_EMBED_ROADMAP_ENABLED: '1',
  });

  const res = spawnSync(process.execPath, [RUNNER], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: timeoutMs + 10_000,
  });

  assert.equal(res.status, 0, `runner exited non-zero — stdout: ${res.stdout}\nstderr: ${res.stderr}`);
  const result = JSON.parse(res.stdout.trim().split('\n').pop());

  assert.equal(result.ok, true, `Job 10 did not produce the expected artifacts: ${JSON.stringify(result)}`);
  assert.equal(result.record.toolCall.tool, 'slack.message');
  assert.equal(result.record.toolCall.args.channel, '#roadmap-updates');
  assert.equal(result.record.state, 'awaiting_approval', 'Job 10 only ever enqueues — it never posts directly');
  assert.equal(result.record.requestedBy.serviceId, 'roadmap-job');

  assert.ok(result.observations.length > 0, 'a roadmap observation was recorded independent of the Slack proposal');
  assert.match(result.observations[0].summary, /Roadmap generated/);
});
