/**
 * tests/functional/embed-daemon-execution-gap-blocked.functional.test.mjs —
 * end-to-end proof that daemon Job 12 ("execution-gap") reports honestly
 * when the Jira provider is not registered at all (the
 * Truth-status vocabulary generalized to Job 12).
 *
 * Companion to embed-daemon-execution-gap.functional.test.mjs (the success
 * path, one unticketed strategy doc → one proposed Jira issue). Here the
 * registry has no 'jira' entry, so `#runExecutionGapAnalysis()` returns
 * `{gaps: [], ranAnalysis: false, ran: false, resultStatus: 'blocked',
 * error: 'jira provider not registered'}` on its first line rather than
 * running any comparison — and the job must report that distinctly from a
 * genuine zero-gap result, not silently propose nothing and log the same
 * "no gaps detected" line a real clean run would.
 *
 * Spawns a real EmbedDaemon (tests/functional/fixtures/
 * embed-daemon-execution-gap-blocked-runner.mjs) with the same seeded
 * strategy-doc observation the success-path fixture uses, and asserts a
 * `type: 'warning'` notification carries `meta.ran === false` and the real
 * blocking reason, while no Jira issue writeIntent is ever proposed.
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
const RUNNER = join(__dirname, 'fixtures', 'embed-daemon-execution-gap-blocked-runner.mjs');

const dirs = [];
after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function freshProject() {
  const root = mkdtempSync(join(tmpdir(), 'cx-embed-daemon-execution-gap-blocked-'));
  dirs.push(root);
  mkdirSync(join(root, '.construct'), { recursive: true });
  return root;
}

test('Job 12 reports "did not run" distinctly from "no gaps" when the Jira provider is not registered', () => {
  const root = freshProject();
  const timeoutMs = 15_000;
  const env = sterileSpawnEnv({
    HOME: root,
    USERPROFILE: root,
    CONSTRUCT_HOME_OVERRIDE: root,
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
  assert.equal(result.ok, true, `tick did not report the blocked state honestly: ${JSON.stringify(result)}`);

  assert.equal(result.event.type, 'warning');
  assert.equal(result.event.source, 'execution-gap');
  assert.equal(result.event.meta.ran, false);
  assert.equal(result.event.meta.error, 'jira provider not registered');
  assert.match(result.event.message, /did not run/);

  assert.equal(result.proposedIssue, null, 'no ticket should ever be proposed for an analysis that never ran');
});
