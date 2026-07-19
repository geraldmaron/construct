/**
 * tests/functional/embed-daemon-write-drain.functional.test.mjs —
 * end-to-end proof of the daemon's "write-intent-drain" job (construct-p4cba.3,
 * WS-B2: the daemon side of `construct approvals approve`).
 *
 * Before this bead, an approved write intent only ever executed via a human
 * running `construct approvals approve <id>` (lib/cli/approvals.mjs) — there
 * was no unattended path from a policy-eligible pending intent to an executed
 * (or durably-failed) outcome. This spawns a real EmbedDaemon
 * (tests/functional/fixtures/embed-daemon-write-drain-runner.mjs) against a
 * pre-seeded ApprovalQueue and a construct.config.json opting `jira.comment`
 * into `writes.policy: 'auto'`, and asserts within one daemon tick:
 *
 *   - the record moves from 'awaiting_approval' to 'approved' (auto-granted,
 *     not left for a human, per the configured policy)
 *   - executionAttempts is durably incremented (ApprovalQueue.recordExecutionOutcome)
 *   - an observation tagged 'write-intent-drain' is recorded, so "what did the
 *     daemon attempt on my behalf" has an audit trail
 *
 * No network: JIRA_URL/JIRA_EMAIL/JIRA_TOKEN are absent from the sterile
 * spawn env, so the governed Jira transport throws a synchronous AuthError —
 * a durable, deterministic failure outcome that still proves every hop in
 * the pipeline ran (config -> auto-grant -> drain -> adapter resolution ->
 * outcome recording), without asserting a successful external write.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(__dirname, 'fixtures', 'embed-daemon-write-drain-runner.mjs');

const dirs = [];
after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function freshProject({ policyMode } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cx-embed-daemon-write-drain-'));
  dirs.push(root);
  mkdirSync(join(root, '.construct'), { recursive: true });
  writeFileSync(join(root, '.construct', 'context.md'), '# test project\n');
  writeFileSync(join(root, 'construct.config.json'), JSON.stringify({
    version: 1,
    writes: { policy: { 'jira.comment': policyMode } },
  }, null, 2));
  return root;
}

function runDaemonTick(root, { timeoutMs = 15_000 } = {}) {
  const persistPath = join(root, '.construct', 'approvals', 'queue.jsonl');
  const seedQueue = new ApprovalQueue({ persistPath });
  const record = seedQueue.enqueue({
    tool: 'jira.comment',
    args: { issueKey: 'OPS-1', body: 'daemon-drafted status update' },
    surface: 'test',
  });

  const env = sterileSpawnEnv({
    HOME: root,
    USERPROFILE: root,
    CONSTRUCT_HOME_OVERRIDE: root,
    CONSTRUCT_ROOT_DIR: root,
    CONSTRUCT_APPROVAL_QUEUE_PATH: persistPath,
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
  return { res, seededApprovalId: record.approvalId };
}

test('an auto-policy write intent is auto-granted and executed (durably, to a failure outcome with no Jira configured) within one daemon tick', () => {
  const root = freshProject({ policyMode: 'auto' });
  const { res, seededApprovalId } = runDaemonTick(root);

  assert.equal(res.status, 0, `runner exited non-zero — stdout: ${res.stdout}\nstderr: ${res.stderr}`);
  const result = JSON.parse(res.stdout.trim().split('\n').pop());
  assert.equal(result.ok, true, `tick did not produce the expected durable outcome: ${JSON.stringify(result)}`);

  assert.equal(result.record.approvalId, seededApprovalId);
  assert.equal(result.record.state, 'approved', 'auto-granted per writes.policy, not left awaiting_approval');
  assert.equal(result.record.decidedBy?.serviceId, 'write-policy-auto-grant');
  assert.ok(result.record.executionAttempts >= 1, 'the drain attempted execution at least once');
  assert.match(result.record.executionError ?? '', /JIRA_URL|JIRA_EMAIL|JIRA_TOKEN/, 'no Jira configured in the sterile env — failure is expected and durable');
  assert.equal(result.record.executedAt, null, 'a failed attempt must not be marked executed');

  assert.ok(result.observations.length > 0, 'an audit observation was recorded for the attempt');
  assert.match(result.observations[0].summary, /write-intent-drain/);
});

test('a pending write intent with no writes.policy entry (fail-safe default) is left for a human, not auto-granted', () => {
  const root = freshProject({ policyMode: undefined });
  // Remove the undefined key so the config round-trips as "no policy configured" rather than an explicit bad value.
  writeFileSync(join(root, 'construct.config.json'), JSON.stringify({ version: 1 }, null, 2));

  const { res, seededApprovalId } = runDaemonTick(root, { timeoutMs: 3_000 });

  // No auto-grant is expected, so poll to a bounded timeout with nothing to
  // wait *for* — this asserts the negative (still awaiting_approval) rather
  // than a positive artifact, so a short timeout keeps the suite fast.
  assert.ok(res.status === 0 || res.status === 1, `unexpected runner crash — stdout: ${res.stdout}\nstderr: ${res.stderr}`);
  const result = JSON.parse(res.stdout.trim().split('\n').pop());

  assert.equal(result.record?.approvalId, seededApprovalId);
  assert.equal(result.record?.state, 'awaiting_approval', 'fail-safe default: unconfigured write kinds wait for a human');
  assert.equal(result.record?.executionAttempts ?? 0, 0, 'never executed while still awaiting approval');
});
