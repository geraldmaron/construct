/**
 * tests/functional/embed-daemon-execution-gap.functional.test.mjs —
 * end-to-end proof that daemon Job 12 ("execution-gap") is rebound to the
 * governed write tree (construct-p4cba.4, WS-B3).
 *
 * Before this bead, this job called `jiraProvider.search()`/`.write()` on
 * the embed read-tree provider — methods it never implemented — so every
 * run threw inside its own try/catch and silently produced nothing.
 *
 * Spawns a real EmbedDaemon (tests/functional/fixtures/
 * embed-daemon-execution-gap-runner.mjs) with a credential-free fake Jira
 * registry entry (only `read('issues', ...)` — no existing tickets), seeds
 * one strategy-doc observation with no matching ticket, and asserts within
 * one tick: a writeIntent ("jira.issue") lands in the approval queue as
 * 'awaiting_approval' (proposed, never auto-executed — the same governed
 * pipeline every other write in this codebase goes through), and an
 * 'execution-gap' observation is recorded describing the gap.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(__dirname, 'fixtures', 'embed-daemon-execution-gap-runner.mjs');

const dirs = [];
after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function freshProject() {
  const root = mkdtempSync(join(tmpdir(), 'cx-embed-daemon-execution-gap-'));
  dirs.push(root);
  mkdirSync(join(root, '.construct'), { recursive: true });
  return root;
}

test('Job 12 proposes a Jira issue for an unticketed strategy doc within one tick (governed pipeline, no direct write)', () => {
  const root = freshProject();
  const timeoutMs = 15_000;
  const env = sterileSpawnEnv({
    HOME: root,
    USERPROFILE: root,
    CX_HOME_OVERRIDE: root,
    CX_ROOT_DIR: root,
    TICK_TIMEOUT_MS: String(timeoutMs),
    CONSTRUCT_EMBEDDING_MODEL: 'hashing',
    CX_INBOX_LIVE_WATCH: 'off',
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
  assert.equal(result.ok, true, `tick did not produce the expected proposal + observation: ${JSON.stringify(result)}`);

  assert.equal(result.proposedIssue.toolCall.tool, 'jira.issue');
  assert.equal(result.proposedIssue.state, 'awaiting_approval', 'proposed, never auto-executed by this job directly');
  assert.equal(result.proposedIssue.requestedBy?.serviceId, 'execution-gap-job');
  assert.match(result.proposedIssue.toolCall.args.summary, /Execution gap/);

  assert.ok(result.observations.length > 0);
  assert.match(result.observations[0].summary, /execution gap|Execution gap/i);
});
