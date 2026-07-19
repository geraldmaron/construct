/**
 * tests/functional/embed-daemon-cross-process-approval.functional.test.mjs —
 * proves the daemon's default-constructed ApprovalQueue (no persistPath
 * override — the production configuration) resolves the exact durable path
 * `construct approvals approve` uses (lib/cli/approvals.mjs), and reloads
 * that file often enough to see a decision made by a separate process
 * while the daemon keeps running.
 *
 * Two properties under test:
 *   - lib/embed/daemon.mjs's EmbedDaemon constructor defaults persistPath
 *     to ApprovalQueue.resolvePersistPath(rootDir, deploymentMode) when not
 *     explicitly overridden, matching lib/cli/approvals.mjs's own
 *     resolution exactly.
 *   - lib/embed/approval-queue.mjs's reloadFromDisk(), called at the top of
 *     every write-intent-drain tick, picks up a state change written by a
 *     process other than the daemon's own.
 *
 * Spawns a real EmbedDaemon with no persistPath override and, from a
 * genuinely separate ApprovalQueue instance, approves a pre-seeded record
 * after the daemon has already started — the same shape as a human running
 * `construct approvals approve` in another terminal while the daemon keeps
 * running. No network: the governed Jira transport throws a synchronous
 * AuthError with no credentials configured, so the drained outcome is a
 * durable failure — proof every hop ran (default path resolution -> reload
 * -> auto-grant skip -> drain -> adapter resolution -> outcome recording)
 * without needing a live Jira instance.
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
const RUNNER = join(__dirname, 'fixtures', 'embed-daemon-cross-process-approval-runner.mjs');

const dirs = [];
after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function freshProject() {
  const root = mkdtempSync(join(tmpdir(), 'cx-embed-daemon-cross-process-'));
  dirs.push(root);
  mkdirSync(join(root, '.construct'), { recursive: true });
  writeFileSync(join(root, '.construct', 'context.md'), '# test project\n');
  writeFileSync(join(root, 'construct.config.json'), JSON.stringify({ version: 1 }, null, 2));
  return root;
}

test('an approval filed from a separate process after the daemon starts is drained on the next tick (default persistPath resolution)', () => {
  const root = freshProject();
  const timeoutMs = 15_000;

  const env = sterileSpawnEnv({
    HOME: root,
    USERPROFILE: root,
    CONSTRUCT_HOME_OVERRIDE: root,
    CONSTRUCT_ROOT_DIR: root,
    TICK_TIMEOUT_MS: String(timeoutMs),
    // Short interval so a second tick fires soon after the cross-process
    // approve() call, without the test waiting out the 2-minute default.
    CONSTRUCT_WRITE_DRAIN_INTERVAL_MS: '300',
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

  assert.equal(result.ok, true, `cross-process approval was not drained: ${JSON.stringify(result)}`);
  assert.equal(result.record.state, 'approved');
  assert.equal(result.record.decidedBy?.userId, 'test-operator', 'approved by the separate queue instance, not auto-granted');
  assert.ok(result.record.executionAttempts >= 1, 'the daemon attempted execution after reloading the externally-approved record');
  assert.match(result.record.executionError ?? '', /JIRA_URL|JIRA_EMAIL|JIRA_TOKEN/, 'no Jira configured in the sterile env — failure is expected and durable');
  assert.ok(result.observations.length > 0, 'an audit observation was recorded for the attempt');
});
