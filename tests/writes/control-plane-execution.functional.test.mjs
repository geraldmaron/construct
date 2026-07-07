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
  return { jira: () => createGovernedJiraProvider({ jiraTransport: transport }) };
}

describe('LMCP-J6 — a specialist-produced writeIntent executes only after plane authorization', () => {
  it('does not execute while awaiting_approval, then executes exactly once after approve()', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'queue.jsonl') });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'sent-log.jsonl') });

    // The specialist step: recommend, never execute. buildWriteIntent is the
    // only shape a specialist may produce; it does not import an adapter.
    const intent = buildWriteIntent({
      providerId: 'jira',
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
      providerId: 'jira',
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
      sections: [{ provider: 'jira', items: [{ id: 'OPS-1', title: 'Pager fired: disk usage' }] }],
    };

    // Step 2: specialist plan — the embed capability's reasoningExecutor
    // output shape (outputPacket + writeProposals), simulating what a real
    // reasoning engine would return per ADR-0061 §3. This is the specialist
    // "recommending" — it returns proposals, it does not call an adapter.
    const writeProposals = [
      { providerId: 'jira', writeKind: 'issue', payload: { project: 'OPS', issueType: 'Task', summary: 'Disk usage pager: create ticket' } },
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
