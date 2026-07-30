/**
 * tests/functional/embed-daemon-directive-runner.functional.test.mjs —
 * end-to-end proof of the daemon's "directive-runner" job.
 *
 * Spawns a real EmbedDaemon (tests/functional/fixtures/
 * embed-daemon-directive-runner-runner.mjs) against a construct.config.json
 * carrying two directives: one valid and due (interval trigger, never run),
 * one referencing an unknown Worker Profile. Asserts within one tick:
 *
 *   - the valid directive gets a 'directive'+'due'-tagged observation and
 *     its due-tracker state (lib/directives/due-tracker.mjs) advances —
 *     the job surfaces the work, it does not execute anything
 *   - the invalid directive is recorded to the degradation ledger
 *     (lib/embed/degradation.mjs) rather than silently dropped or crashing
 *     the whole tick
 *
 * No network: the job never resolves a provider adapter or reasoning
 * executor for this path.
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
const RUNNER = join(__dirname, 'fixtures', 'embed-daemon-directive-runner-runner.mjs');

const dirs = [];
after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function freshProject() {
  const root = mkdtempSync(join(tmpdir(), 'cx-embed-daemon-directive-runner-'));
  dirs.push(root);
  mkdirSync(join(root, '.construct'), { recursive: true });
  writeFileSync(join(root, 'construct.config.json'), JSON.stringify({
    version: 1,
    directives: [
      {
        id: 'jira-weekly-summary',
        provider: 'atlassian-jira',
        workerProfileId: 'operations',
        instruction: "Summarize what the team is working on",
        trigger: { kind: 'interval', intervalMinutes: 10_080 },
        action: 'summarize',
        output: { kind: 'knowledge-note' },
      },
      {
        id: 'bad-directive',
        provider: 'atlassian-jira',
        workerProfileId: 'cx-totally-not-a-real-worker-profile',
        instruction: 'Something',
        trigger: { kind: 'interval', intervalMinutes: 60 },
        action: 'summarize',
        output: { kind: 'knowledge-note' },
      },
    ],
  }, null, 2));
  return root;
}

test('directive-runner surfaces a due directive as an observation and records an invalid one to the degradation ledger', () => {
  const root = freshProject();
  const timeoutMs = 15_000;
  const env = sterileSpawnEnv({
    HOME: root,
    USERPROFILE: root,
    CONSTRUCT_HOME_OVERRIDE: root,
    CONSTRUCT_ROOT_DIR: root,
    TICK_TIMEOUT_MS: String(timeoutMs),
    CONSTRUCT_EMBEDDING_MODEL: 'hashing',
    CONSTRUCT_INBOX_LIVE_WATCH: 'off',
    CONSTRUCT_EMBED_ROADMAP_ENABLED: '0',
  });
  const res = spawnSync(process.execPath, [RUNNER], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: timeoutMs + 10_000,
  });

  assert.equal(res.status, 0, `runner exited non-zero — stdout: ${res.stdout}\nstderr: ${res.stderr}`);
  const result = JSON.parse(res.stdout.trim().split('\n').pop());
  assert.equal(result.ok, true, `tick did not produce the expected artifacts: ${JSON.stringify(result)}`);

  assert.ok(result.observations.length > 0);
  assert.match(result.observations[0].summary, /Directive due: jira-weekly-summary/);

  assert.ok(result.state.lastRunAt, 'due-tracker state advanced for the valid directive');

  assert.ok(result.degradations.length > 0);
  assert.equal(result.degradations[0].reason, 'invalid-directive');
  assert.match(result.degradations[0].detail, /cx-totally-not-a-real-worker-profile/);
});
