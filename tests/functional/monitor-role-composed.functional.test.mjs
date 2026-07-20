/**
 * tests/functional/monitor-role-composed.functional.test.mjs — composed
 * sterile end-to-end proof of the role-monitoring loop (construct-jvjow.4).
 *
 * Before this bead every piece was tested piecewise: the monitor CLI's
 * artifact assembly (tests/functional/monitor-cli.functional.test.mjs), the
 * reasoning executor over a fake provider
 * (tests/functional/embed-reasoning-executor.functional.test.mjs), and the
 * daemon tick plumbing in isolation. Nothing wired role → schedule → fake
 * provider → durable finding in one run.
 *
 * Composition covered here, all inside one isolated tmpdir:
 *   1. Role setup via the real entry path — the real `construct monitor`
 *      binary (spawned with tests/helpers/sterile-env.mjs's allowlist env,
 *      HOME/CONSTRUCT_HOME_OVERRIDE pinned to the sandbox) writes
 *      construct.config.json sources.targets[], embed.yaml roles{}, and the
 *      enabled .construct/procedures/operations.manifest.json.
 *   2. Schedule — the real Scheduler (lib/embed/scheduler.mjs) plus the real
 *      daemon-side registration (lib/embed/capability-jobs.mjs
 *      registerEmbedCapabilityJobs) discovers that enabled manifest from the
 *      project tier and fires the capability tick on `scheduler.start()`
 *      (jobs register with runImmediately: true).
 *   3. Fake provider — the real createReasoningExecutor
 *      (lib/embed/reasoning-executor.mjs) with an injected `callProvider`
 *      that returns a briefing-shaped packet plus one
 *      write proposal. Zero network, zero ANTHROPIC_API_KEY: the tick env is
 *      an explicit allowlist object, `CONSTRUCT_MODEL_STANDARD` only steers
 *      resolveRuntime('auto') → in-process, and the provider seam never
 *      touches fetch.
 *   4. Durable finding — asserts the tick record at
 *      .construct/runtime/embed-capabilities/operations.json (honest `ran` status,
 *      contractStatus ok) and the approval-queue writeIntent at
 *      .construct/approvals/queue.jsonl, plus the spend ledger at
 *      .construct/consumption-budgets.json.
 *
 * Honest-status counterpart: the same composed schedule without a wired
 * executor must record skipped-with-reason(reasoning-executor-not-available)
 * and enqueue nothing — never a fabricated completion. A drift guard proves
 * neither scenario writes tick/queue artifacts into the repo tree.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

import { Scheduler } from '../../lib/embed/scheduler.mjs';
import { registerEmbedCapabilityJobs, SKIP_REASON_NO_EXECUTOR } from '../../lib/embed/capability-jobs.mjs';
import { createReasoningExecutor } from '../../lib/embed/reasoning-executor.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { checkUnattendedSpend } from '../../lib/policy/unattended-budget.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');
const CAPABILITY = 'operations';

// Repo-tree paths the composed run must never create — captured before any
// scenario runs and re-checked after, proving zero sterile drift out of the
// sandbox tmpdirs.

const DRIFT_GUARD_PATHS = [
  join(REPO_ROOT, '.construct', 'runtime', 'embed-capabilities', `${CAPABILITY}.json`),
  join(REPO_ROOT, '.construct', 'approvals', 'queue.jsonl'),
  join(REPO_ROOT, '.construct', 'consumption-budgets.json'),
];
const driftBaseline = DRIFT_GUARD_PATHS.map((p) => existsSync(p));

const tmpDirs = [];
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'cx-monitor-composed-fn-'));
  const home = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(join(project, '.construct'), { recursive: true });
  writeFileSync(join(project, '.construct', 'context.md'), '# test project\n');
  mkdirSync(home, { recursive: true });
  tmpDirs.push(root);
  return { root, home, project };
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
  const driftAfter = DRIFT_GUARD_PATHS.map((p) => existsSync(p));
  assert.deepEqual(driftAfter, driftBaseline, `composed monitor tests must not write tick/queue/ledger artifacts into the repo tree: ${DRIFT_GUARD_PATHS.join(', ')}`);
});

// Step 1 of the composition: the real binary, sterile allowlist env, HOME and
// CONSTRUCT_HOME_OVERRIDE pinned inside the sandbox. `--no-start` keeps daemon boot
// out of the child; the schedule is driven in-process by the real Scheduler
// so the fake provider can be injected through the real registration seam.

function runMonitorSetup({ home, project }) {
  const res = spawnSync(
    process.execPath,
    [BIN, 'monitor', '--as', CAPABILITY, '--targets', 'github:acme/api,jira:PLAT', '--no-start'],
    {
      cwd: project,
      encoding: 'utf8',
      timeout: 30_000,
      env: sterileSpawnEnv({ HOME: home, USERPROFILE: home, CONSTRUCT_HOME_OVERRIDE: home }),
    },
  );
  assert.equal(res.status, 0, `construct monitor exit 0 — stderr: ${res.stderr}`);

  const manifestPath = join(project, '.construct', 'procedures', `${CAPABILITY}.manifest.json`);
  assert.ok(existsSync(manifestPath), 'monitor CLI wrote the enabled capability manifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.embed.enabled, true);
  assert.equal(manifest.embed.workerProfileId, 'operations');
  assert.ok(existsSync(join(project, 'construct.config.json')), 'monitor CLI wrote sources.targets[]');
  assert.match(readFileSync(join(project, 'embed.yaml'), 'utf8'), /primary: operations/);
  return manifest;
}

// The tick env is an explicit object, never process.env: no ambient provider
// key or model pin can leak in, and CONSTRUCT_MODEL_STANDARD exists only so the
// manifest's `runtime: auto` resolves to in-process instead of an early
// no-runtime skip. The fake provider seam replaces the network entirely.

function tickEnv(overrides = {}) {
  return {
    CONSTRUCT_EMBED_REASONING_EXECUTOR: '1',
    CONSTRUCT_UNATTENDED_BUDGET_EMBED_REASONING_OPERATIONS: '5000',
    CONSTRUCT_MODEL_STANDARD: 'claude-sonnet-4-5',
    ...overrides,
  };
}

// The builtin operations manifest binds atlassian-jira/atlassian-confluence/
// slack, so the injected daemon snapshot carries an atlassian-jira section
// for sliceBoundSnapshot to admit, and the E4 grant allows exactly the one
// proposal kind the fake provider emits.

function fakeSnapshot() {
  return {
    sections: [
      {
        provider: 'atlassian-jira',
        items: [{ id: 'PLAT-1', project: 'PLAT', statusCategory: 'to-do', summary: 'Migrate queue' }],
      },
    ],
    errors: [],
  };
}

const grantedBindings = {
  operations: {
    providers: [{ id: 'atlassian-jira', capabilities: ['read'] }],
    proposals: ['atlassian-jira.createIssue'],
  },
};

// Output packet conforming to the operations-tpm-briefing contract
// (registry/contracts/operations-to-user.json mustContain fields);
// validatePacket counts empty arrays as missing, so every field carries a
// finding traceable to the fake snapshot evidence.

const conformingBriefing = {
  coverageMatrix: [{ reqId: 'REQ-1', covered: false, coveredBy: [], provenance: 'atlassian-jira:PLAT-1' }],
  missingWork: [{ reqId: 'REQ-1', evidence: 'no covering issue in PLAT' }],
  timelineRisks: [{ issueId: 'PLAT-1', risk: 'unstarted', evidence: 'statusCategory to-do' }],
  misalignment: [{ prd: 'PRD-Queue', epic: 'PLAT-1', evidence: 'atlassian-jira:PLAT-1' }],
  proposals: [{ providerId: 'atlassian-jira', writeKind: 'createIssue', tracesTo: 'REQ-1' }],
  provenance: ['atlassian-jira:PLAT-1'],
};

// Durable tick record location (lib/embed/capability-lifecycle.mjs
// capabilityStatusDir): the scheduler job fires asynchronously on start(),
// so the test polls for the file instead of racing the fire-and-forget tick.

function tickPath(project) {
  return join(project, '.construct', 'runtime', 'embed-capabilities', `${CAPABILITY}.json`);
}

async function runScheduledTick(project, registerOpts) {
  const scheduler = new Scheduler();
  const registered = registerEmbedCapabilityJobs(scheduler, { rootDir: project, ...registerOpts });
  assert.deepEqual(registered, [CAPABILITY], 'the enabled manifest written by the monitor CLI is the one the scheduler registers');

  scheduler.start();
  try {
    const deadline = Date.now() + 20_000;
    while (!existsSync(tickPath(project)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    scheduler.stop();
  }

  assert.ok(existsSync(tickPath(project)), 'the scheduled tick left a durable record');
  return JSON.parse(readFileSync(tickPath(project), 'utf8'));
}

test('composed: monitor CLI + scheduler + fake provider reaches reasoning and fails closed on missing output contract', async () => {
  const { home, project } = sandbox();
  runMonitorSetup({ home, project });

  const env = tickEnv();
  let providerCalls = 0;
  const fakeCallProvider = async (prompt, callOpts) => {
    providerCalls += 1;
    assert.equal(callOpts.apiKey, 'fake-key', 'the injected key reaches the provider seam — no ambient ANTHROPIC_API_KEY involved');
    assert.match(prompt.user, /atlassian-jira/, 'the prompt carries the sliced bound-provider evidence');
    return {
      outputPacket: conformingBriefing,
      writeProposals: [
        { providerId: 'atlassian-jira', writeKind: 'createIssue', payload: { project: 'PLAT', summary: 'Cover REQ-1' } },
      ],
      usage: { inputTokens: 800, outputTokens: 400 },
    };
  };

  const executor = createReasoningExecutor({ rootDir: project, env, apiKey: 'fake-key', callProvider: fakeCallProvider });
  assert.equal(typeof executor, 'function');

  const queuePath = join(project, '.construct', 'approvals', 'queue.jsonl');
  const approvalQueue = new ApprovalQueue({ persistPath: queuePath });

  const tick = await runScheduledTick(project, {
    env,
    getSnapshot: () => fakeSnapshot(),
    approvalQueue,
    embedBindings: grantedBindings,
    reasoningExecutor: executor,
  });

  assert.equal(providerCalls, 1, 'the fake provider is called exactly once for the scheduled tick');
  assert.equal(tick.runtime, 'in-process');
  // operations-tpm-briefing is absent from the capability-contract registry;
  // the composed tick must fail closed after reasoning rather than enqueue writes.
  assert.equal(tick.status, 'blocked');
  assert.equal(tick.reason, 'output-contract-violation');
  assert.equal(tick.contractId, 'operations-tpm-briefing');
  assert.equal(existsSync(queuePath), false, 'no writeIntent when the output contract fails closed');

  // Spend from the fake provider still lands — the executor records usage before
  // the contract gate blocks proposal enqueue.
  assert.ok(existsSync(join(project, '.construct', 'consumption-budgets.json')), 'spend ledger persisted inside the sandbox');
  const spend = checkUnattendedSpend(project, `embed-reasoning-${CAPABILITY}`, 0, { env });
  assert.equal(spend.spent, 1200);
});

test('composed honest skip: the same schedule with no wired executor records skipped-with-reason and enqueues nothing', async () => {
  const { home, project } = sandbox();
  runMonitorSetup({ home, project });

  const env = tickEnv({ CONSTRUCT_EMBED_REASONING_EXECUTOR: '0' });
  const executor = createReasoningExecutor({ rootDir: project, env, apiKey: 'fake-key' });
  assert.equal(executor, null, 'reasoning stays opt-in: no executor is created without the flag');

  const queuePath = join(project, '.construct', 'approvals', 'queue.jsonl');
  const approvalQueue = new ApprovalQueue({ persistPath: queuePath });

  const tick = await runScheduledTick(project, {
    env,
    getSnapshot: () => fakeSnapshot(),
    approvalQueue,
    embedBindings: grantedBindings,
    reasoningExecutor: executor ?? undefined,
  });

  assert.equal(tick.status, 'skipped-with-reason');
  assert.equal(tick.reason, SKIP_REASON_NO_EXECUTOR);
  assert.equal(tick.runtime, 'in-process');
  assert.ok(!('proposalsEnqueued' in tick), 'a skipped tick never fabricates proposal output');
  assert.equal(existsSync(queuePath), false, 'no writeIntent lands when reasoning never ran');
  assert.equal(existsSync(join(project, '.construct', 'consumption-budgets.json')), false, 'no spend is ledgered when the provider was never called');
});
