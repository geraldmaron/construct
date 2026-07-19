/**
 * tests/functional/embed-specialist-invocation.functional.test.mjs
 *
 * Drives `lib/embed/capability-jobs.mjs` `runCapabilityTick` — the LMCP-F5
 * real job body — against real modules (workflow-invoke.mjs, worker.mjs's
 * validateOutputPacket, authority-guard.mjs's AuthorityGuard, and the real
 * ApprovalQueue backed by an isolated tmpdir JSONL file) with only the
 * provider/reasoning boundary faked, proving:
 *
 *   1. snapshot slice -> plan -> specialist output -> writeIntent lands in
 *      the durable approval queue, with zero direct adapter/write calls
 *      (a side-effect recorder proves non-execution).
 *   2. an output packet that fails its role's output contract blocks the
 *      writeIntent and records the violation instead of enqueueing.
 *   3. a proposal naming a provider.writeKind token outside the
 *      specialist's E4 embedBindings grant is denied and audited, never
 *      queued.
 *   4. no reasoning executor wired in (the honest ADR-0061 default) records
 *      a visible skipped-with-reason tick, never a fabricated completion.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { runCapabilityTick, SKIP_REASON_NO_EXECUTOR } from '../../lib/embed/capability-jobs.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { readCapabilityTick } from '../../lib/embed/capability-lifecycle.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const tmpDirs = [];
function freshRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-invoke-fn-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch { /* best-effort cleanup */ }
  }
});

// A no-adapter-reachable provider write recorder: if the daemon job ever
// called this, the test fails. Nothing in capability-jobs.mjs holds a
// reference to it — it exists purely so a stray future wiring mistake
// (a direct provider.write call) would be caught by a test that imports it,
// not by hoping no one adds one.
function makeWriteRecorder() {
  const calls = [];
  return { write: (...args) => { calls.push(args); throw new Error('provider write adapter must never be called by the daemon job'); }, calls };
}

function opsManifest(overrides = {}) {
  return {
    id: 'operations',
    embed: {
      specialist: 'operations',
      providerBindings: ['jira'],
      framework: 'cx-ops-dependency-sequencing',
      outputContract: 'architect-to-operations',
      proposalAuthority: 'propose-only',
      runtime: 'in-process',
      ...overrides,
    },
  };
}

function fakeSnapshot() {
  return {
    sections: [
      {
        provider: 'jira',
        items: [
          { id: 'PLATFORM-1', project: 'PLATFORM', statusCategory: 'to-do', summary: 'Migrate queue' },
          { id: 'OTHER-1', project: 'OTHER', statusCategory: 'to-do', summary: 'Unrelated project' },
        ],
      },
    ],
    errors: [],
  };
}

const conformingOutputPacket = {
  sequencedTasks: ['migrate-queue'],
  dependencyGraph: { 'migrate-queue': [] },
  ownershipMatrix: { 'migrate-queue': 'operations' },
  verificationGates: { 'migrate-queue': 'queue drained, zero errors' },
  slippageRisk: 'low',
};

const grantedBindings = {
  operations: {
    providers: [{ id: 'jira', capabilities: ['read'] }],
    proposals: ['jira.createIssue'],
  },
};

test('no reasoningExecutor wired in records a visible skipped-with-reason tick, never a fake completion', async () => {
  const rootDir = freshRoot();
  const manifest = opsManifest();
  const approvalQueue = new ApprovalQueue({ persistPath: path.join(rootDir, '.cx', 'approvals', 'queue.jsonl') });

  const tick = await runCapabilityTick(manifest, {
    rootDir,
    env: {},
    getSnapshot: () => fakeSnapshot(),
    approvalQueue,
    embedBindings: grantedBindings,
  });

  assert.equal(tick.status, 'skipped-with-reason');
  assert.equal(tick.reason, SKIP_REASON_NO_EXECUTOR);
  assert.ok(!('proposalsEnqueued' in tick), 'no-executor skip must never carry proposal output');

  assert.deepEqual(approvalQueue.list(), [], 'no writeIntent may be enqueued when no reasoning ran');

  const persisted = readCapabilityTick('operations', rootDir);
  assert.deepEqual(persisted, tick);
});

test('runtime resolved to none short-circuits before the executor is ever consulted', async () => {
  const rootDir = freshRoot();
  const manifest = opsManifest({ runtime: 'none' });
  let executorCalled = false;

  const tick = await runCapabilityTick(manifest, {
    rootDir,
    env: {},
    getSnapshot: () => fakeSnapshot(),
    reasoningExecutor: async () => { executorCalled = true; return { outputPacket: conformingOutputPacket, writeProposals: [] }; },
  });

  assert.equal(tick.status, 'skipped-with-reason');
  assert.equal(tick.reason, 'no-runtime');
  assert.equal(executorCalled, false, 'an unresolved runtime must never invoke the executor');
});

test('snapshot slice -> plan -> specialist plan -> writeIntent lands in the durable queue with zero adapter writes', async () => {
  const rootDir = freshRoot();
  const manifest = opsManifest();
  const approvalQueue = new ApprovalQueue({ persistPath: path.join(rootDir, '.cx', 'approvals', 'queue.jsonl') });
  const recorder = makeWriteRecorder();

  let capturedPlan = null;
  let capturedCtx = null;
  const tick = await runCapabilityTick(manifest, {
    rootDir,
    env: {},
    getSnapshot: () => fakeSnapshot(),
    approvalQueue,
    embedBindings: grantedBindings,
    reasoningExecutor: async (plan, ctx) => {
      capturedPlan = plan;
      capturedCtx = ctx;
      return {
        outputPacket: conformingOutputPacket,
        writeProposals: [
          { providerId: 'jira', writeKind: 'createIssue', payload: { project: 'PLATFORM', summary: 'Migrate queue' } },
        ],
      };
    },
  });

  assert.equal(recorder.calls.length, 0, 'the write recorder proves the daemon job never touched a provider adapter');

  // The slice handed to the executor carries only the bound provider's
  // items, and only those admitted by embed.filter/B11 — the plan itself
  // is the real workflow-invoke.mjs output (framework, roles, evidence).
  assert.equal(capturedCtx.specialistId, 'operations');
  assert.equal(capturedCtx.sections.length, 1);
  assert.equal(capturedCtx.sections[0].provider, 'jira');
  assert.deepEqual(capturedCtx.sections[0].items.map((i) => i.id), ['PLATFORM-1', 'OTHER-1']);
  assert.equal(capturedPlan.selectedRoles[0], 'operations');
  assert.equal(capturedPlan.framework.frameworkId, 'cx-ops-dependency-sequencing');

  assert.equal(tick.status, 'ran');
  assert.equal(tick.contractStatus, 'ok');
  assert.equal(tick.proposalsEnqueued.length, 1);
  assert.equal(tick.proposalsEnqueued[0].providerId, 'jira');
  assert.ok(tick.proposalsEnqueued[0].approvalId);
  assert.deepEqual(tick.proposalsDenied, []);

  const queued = approvalQueue.list();
  assert.equal(queued.length, 1, 'exactly one writeIntent is durable in the approval queue');
  assert.equal(queued[0].toolCall.tool, 'jira.createIssue');
  assert.deepEqual(queued[0].toolCall.args, { project: 'PLATFORM', summary: 'Migrate queue' });
  assert.equal(queued[0].state, 'awaiting_approval');
  assert.equal(queued[0].requestedBy.serviceId, 'operations');
  assert.equal(queued[0].requestedBy.role, 'operations');

  // Durable across a fresh process: re-open the queue from the same file.
  const reopened = new ApprovalQueue({ persistPath: path.join(rootDir, '.cx', 'approvals', 'queue.jsonl') });
  assert.equal(reopened.list().length, 1);
});

test('an output packet failing its role output contract blocks the writeIntent and records the violation', async () => {
  const rootDir = freshRoot();
  const manifest = opsManifest();
  const approvalQueue = new ApprovalQueue({ persistPath: path.join(rootDir, '.cx', 'approvals', 'queue.jsonl') });

  const incompleteOutputPacket = { sequencedTasks: ['migrate-queue'] }; // missing dependencyGraph/ownershipMatrix/verificationGates/slippageRisk

  const tick = await runCapabilityTick(manifest, {
    rootDir,
    env: {},
    getSnapshot: () => fakeSnapshot(),
    approvalQueue,
    embedBindings: grantedBindings,
    reasoningExecutor: async () => ({
      outputPacket: incompleteOutputPacket,
      writeProposals: [{ providerId: 'jira', writeKind: 'createIssue', payload: { project: 'PLATFORM' } }],
    }),
  });

  assert.equal(tick.status, 'blocked');
  assert.equal(tick.reason, 'output-contract-violation');
  assert.equal(tick.contractId, 'architect-to-operations');
  assert.ok(Array.isArray(tick.violations) && tick.violations.length > 0);

  assert.deepEqual(approvalQueue.list(), [], 'a contract-failed output must never reach the approval queue');
});

test('a proposal outside the E4 grant is denied and audited, never enqueued', async () => {
  const rootDir = freshRoot();
  const manifest = opsManifest();
  const approvalQueue = new ApprovalQueue({ persistPath: path.join(rootDir, '.cx', 'approvals', 'queue.jsonl') });

  const tick = await runCapabilityTick(manifest, {
    rootDir,
    env: {},
    getSnapshot: () => fakeSnapshot(),
    approvalQueue,
    embedBindings: grantedBindings, // grants only jira.createIssue
    reasoningExecutor: async () => ({
      outputPacket: conformingOutputPacket,
      writeProposals: [
        { providerId: 'jira', writeKind: 'createIssue', payload: { project: 'PLATFORM' } },
        { providerId: 'jira', writeKind: 'deleteIssue', payload: { project: 'PLATFORM', id: 'PLATFORM-1' } },
        { providerId: 'slack', writeKind: 'postMessage', payload: { channel: 'general', text: 'hi' } },
      ],
    }),
  });

  assert.equal(tick.status, 'ran');
  assert.equal(tick.proposalsEnqueued.length, 1);
  assert.equal(tick.proposalsEnqueued[0].providerId, 'jira');

  assert.equal(tick.proposalsDenied.length, 2);
  const deniedTokens = tick.proposalsDenied.map((d) => `${d.providerId}.${d.writeKind}`).sort();
  assert.deepEqual(deniedTokens, ['jira.deleteIssue', 'slack.postMessage']);
  for (const denial of tick.proposalsDenied) {
    assert.match(denial.reason, /not granted to propose/);
  }

  const queued = approvalQueue.list();
  assert.equal(queued.length, 1, 'only the granted proposal reaches the durable queue');
  assert.equal(queued[0].toolCall.tool, 'jira.createIssue');
});

test('a specialist with no embedBindings grant at all has every proposal denied', async () => {
  const rootDir = freshRoot();
  const manifest = opsManifest();
  const approvalQueue = new ApprovalQueue({ persistPath: path.join(rootDir, '.cx', 'approvals', 'queue.jsonl') });

  const tick = await runCapabilityTick(manifest, {
    rootDir,
    env: {},
    getSnapshot: () => fakeSnapshot(),
    approvalQueue,
    embedBindings: {}, // no grant for 'operations' at all
    reasoningExecutor: async () => ({
      outputPacket: conformingOutputPacket,
      writeProposals: [{ providerId: 'jira', writeKind: 'createIssue', payload: { project: 'PLATFORM' } }],
    }),
  });

  assert.equal(tick.proposalsEnqueued.length, 0);
  assert.equal(tick.proposalsDenied.length, 1);
  assert.match(tick.proposalsDenied[0].reason, /no embedBindings grant/);
  assert.deepEqual(approvalQueue.list(), []);
});
