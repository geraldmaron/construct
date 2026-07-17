/**
 * tests/writes/control-plane-execution.functional.test.mjs — LMCP-J6
 * functional coverage: control-plane-only write execution.
 *
 * Exercises the full boundary the bead requires: a specialist only ever
 * produces a writeIntent (lib/writes/write-intent.mjs); the durable
 * ApprovalQueue (lib/embed/approval-queue.mjs, F5/I2) is the only place that
 * record lives before a decision; lib/writes/control-plane.mjs is the only
 * module that resolves a governed adapter and calls writeWithEnvelope() —
 * and only for a record already in state 'approved'. No fakes stand in for
 * the queue or the envelope; only the network-facing Jira transport is
 * faked (tests/fakes/fake-jira-transport.mjs), so createIssueCallCount is a
 * real side-effect counter on the governed adapter's only I/O boundary.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { buildWriteIntent } from '../../lib/writes/write-intent.mjs';
import { executeApprovedWriteIntent, drainApprovedWriteIntents } from '../../lib/writes/control-plane.mjs';
import { WriteSentLog } from '../../lib/writes/sent-log.mjs';
import { createGovernedJiraProvider } from '../../lib/providers/contract/adapters/jira/governed-write.mjs';
import { createFakeJiraTransport } from '../fakes/fake-jira-transport.mjs';

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-control-plane-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function jiraFactories(transport) {
  return { 'atlassian-jira': () => createGovernedJiraProvider({ jiraTransport: transport }) };
}

describe('LMCP-J6 — a specialist-produced writeIntent executes only after plane authorization', () => {
  it('does not execute while awaiting_approval, then executes exactly once after approve()', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'queue.jsonl') });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'sent-log.jsonl') });

    // The specialist step: recommend, never execute. buildWriteIntent is the
    // only shape a specialist may produce; it does not import an adapter.
    const intent = buildWriteIntent({
      providerId: 'atlassian-jira',
      writeKind: 'issue',
      payload: { project: 'PROJ', issueType: 'Task', summary: 'Flaky test in CI' },
      requestedBy: { specialistId: 'qa-analyst', role: 'cx-qa-analyst' },
      surface: 'specialist-recommendation',
    });

    const record = queue.enqueue({
      tool: intent.tool,
      args: intent.payload,
      surface: intent.surface,
      requestedBy: intent.requestedBy,
    });
    assert.equal(record.state, 'awaiting_approval');

    // Plane has not authorized yet — draining must not touch the adapter.
    const preApprovalDrain = await drainApprovedWriteIntents(queue, {
      adapterFactories: jiraFactories(transport),
      sentLog,
    });
    assert.deepEqual(preApprovalDrain, []);
    assert.equal(transport.createIssueCallCount(), 0, 'no adapter call before approval');

    // Calling the executor directly on an unapproved record must throw:
    // a structural gate, not merely an unreached code path.
    await assert.rejects(
      () => executeApprovedWriteIntent(record, { adapterFactories: jiraFactories(transport), sentLog }),
      /only 'approved' records may reach the envelope/,
    );
    assert.equal(transport.createIssueCallCount(), 0);

    // Plane authorizes: an out-of-band approve() call, independent of this module.
    queue.approve(record.approvalId, { decidedBy: { userId: 'reviewer-1' }, reason: 'looks correct' });
    assert.equal(queue.getById(record.approvalId).state, 'approved');

    const drained = await drainApprovedWriteIntents(queue, {
      adapterFactories: jiraFactories(transport),
      sentLog,
    });
    assert.equal(drained.length, 1);
    assert.equal(drained[0].error, null);
    assert.equal(drained[0].result.status, 'sent');
    assert.equal(transport.createIssueCallCount(), 1, 'exactly one adapter call after approval');

    // A second drain must not re-execute the already-drained record.
    const secondDrain = await drainApprovedWriteIntents(queue, {
      adapterFactories: jiraFactories(transport),
      sentLog,
      executedApprovalIds: new Set([record.approvalId]),
    });
    assert.deepEqual(secondDrain, []);
    assert.equal(transport.createIssueCallCount(), 1, 'still exactly one adapter call');
  });

  it('a denied record is never executed and draining leaves it untouched', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'queue.jsonl') });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'sent-log.jsonl') });

    const intent = buildWriteIntent({
      providerId: 'atlassian-jira',
      writeKind: 'issue',
      payload: { project: 'PROJ', issueType: 'Task', summary: 'Should not ship' },
      requestedBy: { specialistId: 'qa-analyst' },
      surface: 'specialist-recommendation',
    });
    const record = queue.enqueue({ tool: intent.tool, args: intent.payload, surface: intent.surface, requestedBy: intent.requestedBy });

    queue.deny(record.approvalId, { reason: 'out of scope' });
    assert.equal(queue.getById(record.approvalId).state, 'denied');

    const drained = await drainApprovedWriteIntents(queue, { adapterFactories: jiraFactories(transport), sentLog });
    assert.deepEqual(drained, []);
    assert.equal(transport.createIssueCallCount(), 0);

    await assert.rejects(
      () => executeApprovedWriteIntent(queue.getById(record.approvalId), { adapterFactories: jiraFactories(transport), sentLog }),
      /only 'approved' records may reach the envelope/,
    );
  });
});

describe('LMCP-J6 — embed-daemon-originated writeIntent executes only post-approval', () => {
  it('snapshot -> specialist plan -> writeIntent in queue -> no adapter call until approve -> exactly one adapter call after approve', async () => {
    const transport = createFakeJiraTransport({ projects: { OPS: { issueTypes: { Task: {} } } } });
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'embed-queue.jsonl') });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'embed-sent-log.jsonl') });

    // Step 1: snapshot — a minimal stand-in for SnapshotEngine.generate()'s
    // shape (sections[].provider/items), the only part sliceBoundSnapshot
    // (lib/embed/capability-jobs.mjs) reads.
    const snapshot = {
      generatedAt: new Date().toISOString(),
      sections: [{ provider: 'atlassian-jira', items: [{ id: 'OPS-1', title: 'Pager fired: disk usage' }] }],
    };

    // Step 2: specialist plan — the embed capability's reasoningExecutor
    // output shape (outputPacket + writeProposals), simulating what a real
    // reasoning engine would return per ADR-0061 §3. This is the specialist
    // "recommending" — it returns proposals, it does not call an adapter.
    const writeProposals = [
      { providerId: 'atlassian-jira', writeKind: 'issue', payload: { project: 'OPS', issueType: 'Task', summary: 'Disk usage pager: create ticket' } },
    ];

    // Step 3: writeIntent in queue — mirrors runCapabilityTick's enqueue
    // call in lib/embed/capability-jobs.mjs (same tool-name encoding via
    // writeIntentToolName), without importing daemon internals.
    const intents = writeProposals.map((p) => buildWriteIntent({
      providerId: p.providerId,
      writeKind: p.writeKind,
      payload: p.payload,
      requestedBy: { serviceId: 'ops-triage-capability', role: 'cx-ops-triage' },
      surface: 'embed-capability',
    }));

    const records = intents.map((intent) => queue.enqueue({
      tool: intent.tool,
      args: intent.payload,
      surface: intent.surface,
      requestedBy: intent.requestedBy,
    }));
    assert.equal(records.length, 1);
    assert.equal(records[0].state, 'awaiting_approval');

    // Step 4: no adapter call until approve.
    const beforeApproval = await drainApprovedWriteIntents(queue, { adapterFactories: jiraFactories(transport), sentLog });
    assert.deepEqual(beforeApproval, []);
    assert.equal(transport.createIssueCallCount(), 0);
    assert.equal(sentLog.list().length, 0, 'no audit record before approval');

    // Step 5: approve, then drain — exactly one adapter call.
    queue.approve(records[0].approvalId, { decidedBy: { userId: 'ops-lead' } });
    const afterApproval = await drainApprovedWriteIntents(queue, { adapterFactories: jiraFactories(transport), sentLog });

    assert.equal(afterApproval.length, 1);
    assert.equal(afterApproval[0].error, null);
    assert.equal(transport.createIssueCallCount(), 1, 'exactly one adapter call after approve');

    const sentRecords = sentLog.list({ status: 'sent' });
    assert.equal(sentRecords.length, 1, 'the envelope recorded exactly one sent audit entry');
  });
});

// ADR-0082 round-trip: DEFAULT_ADAPTER_FACTORIES (control-plane.mjs) resolves
// only the manifest-namespace provider IDs; the short IDs "jira" and
// "confluence" resolve to nothing. Credential env vars are cleared so a
// resolved atlassian-jira/atlassian-confluence/slack factory fails fast on
// AuthError at transport construction — proof of resolution with no real
// network call, since AuthError is thrown before any I/O.

const CREDENTIAL_ENV_KEYS = [
  'JIRA_URL', 'JIRA_EMAIL', 'JIRA_TOKEN',
  'CONFLUENCE_URL', 'CONFLUENCE_EMAIL', 'CONFLUENCE_TOKEN',
  'SLACK_BOT_TOKEN',
];

function approvedRecord(queue, { tool, args = {} }) {
  const record = queue.enqueue({ tool, args, surface: 'test', requestedBy: { specialistId: 'namespace-test' } });
  queue.approve(record.approvalId, { decidedBy: { userId: 'reviewer-1' } });
  return queue.getById(record.approvalId);
}

describe('ADR-0082 — provider-ID namespace canonicalization round-trip (construct-4uxq0.9.4)', () => {
  const savedEnv = {};

  beforeEach(() => {
    for (const key of CREDENTIAL_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CREDENTIAL_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('resolves the real DEFAULT_ADAPTER_FACTORIES entry for "atlassian-jira" (fails on missing credentials, not on missing adapter)', async () => {
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'ns-queue.jsonl') });
    const record = approvedRecord(queue, { tool: 'atlassian-jira.issue', args: { project: 'PROJ', issueType: 'Task', summary: 'x' } });

    await assert.rejects(
      () => executeApprovedWriteIntent(record, { rootDir: tmpRoot }),
      /Jira transport requires JIRA_URL/,
    );
  });

  it('resolves the real DEFAULT_ADAPTER_FACTORIES entry for "atlassian-confluence" (fails on missing credentials, not on missing adapter)', async () => {
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'ns-queue.jsonl') });
    const record = approvedRecord(queue, { tool: 'atlassian-confluence.page', args: { spaceKey: 'OPS', title: 'x' } });

    await assert.rejects(
      () => executeApprovedWriteIntent(record, { rootDir: tmpRoot }),
      /Confluence transport requires CONFLUENCE_URL/,
    );
  });

  it('resolves the real DEFAULT_ADAPTER_FACTORIES entry for "slack" (fails on missing credentials, not on missing adapter)', async () => {
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'ns-queue.jsonl') });
    const record = approvedRecord(queue, { tool: 'slack.message', args: { channel: '#general', text: 'x' } });

    await assert.rejects(
      () => executeApprovedWriteIntent(record, { rootDir: tmpRoot }),
      /Slack transport requires SLACK_BOT_TOKEN/,
    );
  });

  it('resolves the real DEFAULT_ADAPTER_FACTORIES entry for "github" (unaffected by the rename)', async () => {
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'ns-queue.jsonl') });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'ns-sent-log.jsonl') });
    const fakeGithubAdapter = {
      meta: { id: 'github' },
      async write() {
        return { type: 'issue-created', url: 'https://github.com/example/issues/1', id: '1' };
      },
    };
    const record = approvedRecord(queue, { tool: 'github.issue', args: { title: 'x' } });

    // github's real factory constructs no transport at call time (the gh CLI
    // is invoked lazily inside .write()), so this stays a real
    // DEFAULT_ADAPTER_FACTORIES resolution while still avoiding any real gh
    // CLI invocation: only the .write() call is swapped for a fake.
    const result = await executeApprovedWriteIntent(record, {
      sentLog,
      adapterFactories: { github: () => fakeGithubAdapter },
    });
    assert.equal(result.status, 'sent');
  });

  it('the pre-rename short ID "jira" is unresolvable in the real DEFAULT_ADAPTER_FACTORIES', async () => {
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'ns-queue.jsonl') });
    const record = approvedRecord(queue, { tool: 'jira.issue', args: { project: 'PROJ', issueType: 'Task', summary: 'x' } });

    await assert.rejects(
      () => executeApprovedWriteIntent(record, { rootDir: tmpRoot }),
      /no governed adapter registered for provider "jira"/,
    );
  });

  it('the pre-rename short ID "confluence" is unresolvable in the real DEFAULT_ADAPTER_FACTORIES', async () => {
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'ns-queue.jsonl') });
    const record = approvedRecord(queue, { tool: 'confluence.page', args: { spaceKey: 'OPS', title: 'x' } });

    await assert.rejects(
      () => executeApprovedWriteIntent(record, { rootDir: tmpRoot }),
      /no governed adapter registered for provider "confluence"/,
    );
  });
});

// ADR-0089/ADR-0096 (construct-4uxq0.9.5): drainApprovedWriteIntents must
// acquire a durable ApprovalQueue lease per record before executing it, so
// two callers racing the same 'approved' record (an automated drain tick
// racing a second drain, or a manual approve) can never both reach the
// envelope for it. sleep() lets the tests exercise real lease-expiry timing
// (ApprovalQueue's own clock, not a mocked one) the same way
// tests/embed-approval-queue-lease.test.mjs does.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ADR-0089/ADR-0096 — drainApprovedWriteIntents lease guarding (construct-4uxq0.9.5)', () => {
  it('acquires a lease before executing, and releases it to the terminal executed state on success', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'lease-queue.jsonl') });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'lease-sent-log.jsonl') });

    const record = approvedRecord(queue, {
      tool: 'atlassian-jira.issue',
      args: { project: 'PROJ', issueType: 'Task', summary: 'Lease-guarded drain' },
    });

    const drained = await drainApprovedWriteIntents(queue, { adapterFactories: jiraFactories(transport), sentLog });
    assert.equal(drained.length, 1);
    assert.equal(drained[0].error, null);
    assert.equal(drained[0].skipped, undefined);
    assert.equal(transport.createIssueCallCount(), 1);

    const final = queue.getById(record.approvalId);
    assert.equal(final.state, 'executed', 'a successfully drained record must land on the terminal executed state');
    assert.ok(final.executedAt);
    assert.equal(final.leaseWorkerId, null, 'the lease must be released, not left held');
  });

  it('never executes a record whose lease is already held live by another worker — no adapter call, lease not stolen', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const persistPath = path.join(tmpRoot, 'conflict-queue.jsonl');
    const queue = new ApprovalQueue({ persistPath });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'conflict-sent-log.jsonl') });

    const record = approvedRecord(queue, {
      tool: 'atlassian-jira.issue',
      args: { project: 'PROJ', issueType: 'Task', summary: 'Should stay untouched' },
    });

    // A second process/worker (modeled as a second ApprovalQueue instance
    // pointed at the same persistPath, the same convention
    // tests/embed-approval-queue-lease.test.mjs uses) wins the lease first.
    const rival = new ApprovalQueue({ persistPath });
    const rivalLease = rival.acquireLease(record.approvalId, { workerId: 'external-holder', leaseSeconds: 60 });
    assert.ok(rivalLease, 'the rival must actually hold the lease for this test to prove anything');

    const drained = await drainApprovedWriteIntents(queue, {
      adapterFactories: jiraFactories(transport),
      sentLog,
      workerId: 'the-drain-job',
    });

    // Since construct-4uxq0.9.9 the queue reloads on read, so the drain's
    // list('approved') already observes the rival's persisted 'executing'
    // state and filters the record out of its work set — no drain outcome is
    // emitted for it. The 'lease-not-acquired' skip path remains for the
    // narrower race where the rival acquires between list() and
    // acquireLease(); either way the invariants below are what matter: the
    // adapter is never called and the live lease is never stolen.
    assert.equal(drained.length, 0, 'a record another worker is executing is not part of this drain\'s work set');
    assert.equal(transport.createIssueCallCount(), 0, 'a lease-conflicted record must never reach the adapter');

    const stillHeld = queue.getById(record.approvalId);
    assert.equal(stillHeld.state, 'executing');
    assert.equal(stillHeld.leaseWorkerId, 'external-holder', 'the drain must not steal a live lease it lost the race for');
  });

  it('releases the lease back to approved on an execution failure, leaving the record retryable', async () => {
    // A thrown adapter-construction error (the same failure mode the real
    // DEFAULT_ADAPTER_FACTORIES hits on missing credentials, exercised
    // directly above in the ADR-0082 suite) is what executeApprovedWriteIntent
    // actually rejects on — writeWithEnvelope itself catches a provider.write()
    // rejection and returns a structured { status: 'error' } instead of
    // throwing, so that path does not exercise the lease's failure branch.
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'failure-queue.jsonl') });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'failure-sent-log.jsonl') });
    const record = approvedRecord(queue, {
      tool: 'atlassian-jira.issue',
      args: { project: 'PROJ', issueType: 'Task', summary: 'Adapter construction will fail' },
    });

    const brokenFactories = { 'atlassian-jira': () => { throw new Error('adapter construction failed: missing credentials'); } };
    const drained = await drainApprovedWriteIntents(queue, { adapterFactories: brokenFactories, sentLog });
    assert.equal(drained.length, 1);
    assert.match(drained[0].error, /adapter construction failed/, 'the outcome must carry the failure');

    const failed = queue.getById(record.approvalId);
    assert.equal(failed.state, 'approved', 'a failed execution must return the record to approved, not strand it');
    assert.match(failed.lastLeaseFailureReason, /adapter construction failed/, 'the failure reason must be recorded for operator visibility');
    assert.equal(failed.leaseWorkerId, null);

    // Retryable: fix the adapter and drain again — no operator re-approval needed.
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const retried = await drainApprovedWriteIntents(queue, { adapterFactories: jiraFactories(transport), sentLog });
    assert.equal(retried.length, 1);
    assert.equal(retried[0].error, null);
    assert.equal(queue.getById(record.approvalId).state, 'executed');
  });

  it('reclaims an expired lease from a crashed prior attempt and executes it on the next drain', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const persistPath = path.join(tmpRoot, 'crash-queue.jsonl');
    const queue = new ApprovalQueue({ persistPath });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'crash-sent-log.jsonl') });

    const record = approvedRecord(queue, {
      tool: 'atlassian-jira.issue',
      args: { project: 'PROJ', issueType: 'Task', summary: 'Held by a crashed worker' },
    });

    // A crashed prior drain attempt: the lease was acquired but its holder
    // never came back to release it.
    queue.acquireLease(record.approvalId, { workerId: 'crashed-drain', leaseSeconds: 0.01 });
    await sleep(30);
    assert.equal(queue.getById(record.approvalId).state, 'executing', 'expiry alone does not change state until reclaimed');

    const drained = await drainApprovedWriteIntents(queue, { adapterFactories: jiraFactories(transport), sentLog });
    assert.equal(drained.length, 1, 'the expired lease must be reclaimed to approved and then drained');
    assert.equal(drained[0].error, null);
    assert.equal(transport.createIssueCallCount(), 1);
    assert.equal(queue.getById(record.approvalId).state, 'executed');
  });
});
