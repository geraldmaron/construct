/**
 * tests/acceptance/ops-triage-preset.acceptance.test.mjs — golden-fixture
 * acceptance for the `operations` embed preset (triage mode).
 *
 * @embed operations-triage
 *
 * Drives real embed capability tick with injected deterministic triage
 * reasoningExecutor over seeded snapshot built from fake providers (Jira +
 * Confluence). Asserts acceptance: duplicate detection produces proposals;
 * under-specified detection produces comment proposals; no write executes
 * without approval.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeJira, FakeConfluence } from '../fakes/index.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { runCapabilityTick } from '../../lib/embed/capability-jobs.mjs';
import { createOpsTriageReasoningExecutor, analyzeOpsTriage } from '../../lib/embed/presets/ops-triage.mjs';
import { writeWithEnvelope } from '../../lib/writes/envelope.mjs';
import { validatePacket } from '../../lib/capability-contracts.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const realFetch = globalThis.fetch;

// Seeded fixture: three issues. PAY-1 and PAY-2 are duplicates (same summary
// pattern, same component). PAY-3 is under-specified (description too short).

const JIRA_ISSUES = [
  {
    key: 'PAY-1',
    id: '1',
    summary: 'Add payment processing with credit cards',
    description: 'Users need to pay with saved cards for subscription',
    type: 'Feature',
    component: 'payments',
    status: 'To Do',
    created: '2026-07-03T00:00:00.000Z',
  },
  {
    key: 'PAY-2',
    id: '2',
    summary: 'Implement credit card payment processing',
    description: 'Support payment processing for cards',
    type: 'Feature',
    component: 'payments',
    status: 'To Do',
    created: '2026-07-03T01:00:00.000Z',
  },
  {
    key: 'PAY-3',
    id: '3',
    summary: 'Refunds',
    description: 'Handle refunds',
    type: 'Task',
    component: 'billing',
    status: 'To Do',
    created: '2026-07-03T02:00:00.000Z',
  },
];

const OPERATIONS_MANIFEST = {
  id: 'operations-triage',
  version: '1.0.0',
  type: 'embed',
  defaultApprovalMode: 'proposal-only',
  embed: {
    specialist: 'operations',
    providerBindings: ['atlassian-jira', 'atlassian-confluence', 'directory'],
    framework: 'cx-ops-dependency-sequencing',
    outputContract: 'operations-triage',
    proposalAuthority: 'propose-only',
    runtime: 'in-process',
    cadence: { every: 'PT2H' },
  },
};

const EMBED_BINDINGS = {
  operations: {
    providers: [
      { id: 'atlassian-jira', capabilities: ['read', 'search'] },
      { id: 'atlassian-confluence', capabilities: ['read', 'search'] },
      { id: 'directory', capabilities: ['read', 'search'] },
    ],
    proposals: ['atlassian-jira.updateItem', 'atlassian-jira.comment'],
  },
};

const FIXED_NOW = Date.parse('2026-07-03T00:00:00.000Z');

function buildSeededSnapshot() {
  return {
    sections: [
      { provider: 'atlassian-jira', refs: ['PAY'], items: JIRA_ISSUES },
      { provider: 'atlassian-confluence', refs: ['CONF'], items: [] },
      { provider: 'directory', refs: [], items: [] },
    ],
  };
}

// Recording provider registry: wraps fakes and counts writes.

function recordingProviders() {
  const jira = FakeJira();
  const confluence = FakeConfluence();
  const writeCalls = [];

  for (const [id, p] of [['atlassian-jira', jira], ['atlassian-confluence', confluence]]) {
    const original = p.write.bind(p);
    p.write = async (config, payload) => {
      writeCalls.push({ provider: id, payload });
      return original(config, payload);
    };
  }
  return { jira, confluence, writeCalls };
}

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'ops-triage-'));
}

test('seeded duplicate pair detected → duplicate-link proposal queued, zero adapter writes', async () => {
  globalThis.fetch = () => { throw new Error('Real network blocked in acceptance test'); };
  const rootDir = tmpRoot();
  try {
    const providers = recordingProviders();
    const approvalQueue = new ApprovalQueue({ persistPath: join(rootDir, 'queue.jsonl') });
    const executor = createOpsTriageReasoningExecutor({ now: FIXED_NOW });

    const tick = await runCapabilityTick(OPERATIONS_MANIFEST, {
      rootDir,
      env: process.env,
      getSnapshot: () => buildSeededSnapshot(),
      approvalQueue,
      embedBindings: EMBED_BINDINGS,
      reasoningExecutor: executor,
    });

    assert.equal(tick.status, 'ran', `tick should run, got ${tick.status} (${tick.reason ?? ''})`);
    assert.equal(tick.contractStatus, 'ok', 'output packet must satisfy its contract');

    // At least one duplicate-link proposal should be queued.
    const linkProposals = tick.proposalsEnqueued.filter((p) => p.writeKind === 'updateItem');
    assert.ok(linkProposals.length >= 1, 'at least one duplicate-link proposal enqueued');

    const queued = approvalQueue.list('awaiting_approval');
    assert.ok(queued.length >= 1, 'at least one intent awaiting approval');

    // Find the duplicate-link intent.
    const duplicateLinkIntent = queued.find((intent) => intent.toolCall.tool === 'atlassian-jira.updateItem');
    assert.ok(duplicateLinkIntent, 'duplicate-link intent found in approval queue');

    assert.equal(providers.writeCalls.length, 0, 'NOTHING executes: zero provider writes during tick');
  } finally {
    globalThis.fetch = realFetch;
    rmTmpDir(rootDir);
  }
});

test('under-specified ticket → needs-info comment proposal queued', async () => {
  globalThis.fetch = () => { throw new Error('Real network blocked in acceptance test'); };
  const rootDir = tmpRoot();
  try {
    const providers = recordingProviders();
    const approvalQueue = new ApprovalQueue({ persistPath: join(rootDir, 'queue.jsonl') });
    const executor = createOpsTriageReasoningExecutor({ now: FIXED_NOW });

    const tick = await runCapabilityTick(OPERATIONS_MANIFEST, {
      rootDir,
      env: process.env,
      getSnapshot: () => buildSeededSnapshot(),
      approvalQueue,
      embedBindings: EMBED_BINDINGS,
      reasoningExecutor: executor,
    });

    assert.equal(tick.status, 'ran', `tick should run, got ${tick.status} (${tick.reason ?? ''})`);

    // At least one comment proposal should be queued (for under-specified PAY-3).
    const commentProposals = tick.proposalsEnqueued.filter((p) => p.writeKind === 'comment');
    assert.ok(commentProposals.length >= 1, 'at least one needs-info comment proposal enqueued');

    const queued = approvalQueue.list('awaiting_approval');
    const commentIntent = queued.find((intent) => intent.toolCall.tool === 'atlassian-jira.comment');
    assert.ok(commentIntent, 'needs-info comment intent found in approval queue');
    assert.match(commentIntent.toolCall.args.text, /detail|criteria/, 'comment asks for more detail/criteria');
  } finally {
    globalThis.fetch = realFetch;
    rmTmpDir(rootDir);
  }
});

test('triage output validates against its contract; findings carry provenance', () => {
  const { outputPacket, analysis } = analyzeOpsTriage(buildSeededSnapshot().sections, { now: FIXED_NOW });

  const result = validatePacket('operations-triage', outputPacket, 'output');
  assert.ok(result.ok, `triage packet must validate; missing: ${result.missing?.join(', ')}`);

  // Verify duplicates findings cite the issues.
  for (const finding of analysis.duplicates) {
    assert.ok(finding.evidence.issue, 'duplicate finding cites the issue key');
    assert.ok(finding.evidence.candidate, 'duplicate finding cites the candidate key');
    assert.match(finding.statement, /source/, 'duplicate statement carries source ids');
  }

  // Verify under-specified findings cite the issue.
  for (const finding of analysis.underspecified) {
    assert.ok(finding.evidence.issue, 'underspecified finding cites the issue key');
    assert.match(finding.statement, /source/, 'underspecified statement carries source id');
  }

  assert.ok(analysis.inventoried.length > 0, 'inventory is populated');
});

test('no adapter call without approval: proposals remain queued until approved', async () => {
  globalThis.fetch = () => { throw new Error('Real network blocked in acceptance test'); };
  const rootDir = tmpRoot();
  try {
    const providers = recordingProviders();
    const approvalQueue = new ApprovalQueue({ persistPath: join(rootDir, 'queue.jsonl') });
    const executor = createOpsTriageReasoningExecutor({ now: FIXED_NOW });

    await runCapabilityTick(OPERATIONS_MANIFEST, {
      rootDir,
      env: process.env,
      getSnapshot: () => buildSeededSnapshot(),
      approvalQueue,
      embedBindings: EMBED_BINDINGS,
      reasoningExecutor: executor,
    });

    const pending = approvalQueue.list('awaiting_approval');
    assert.ok(pending.length >= 2, 'at least 2 intents awaiting approval (duplicate-link + comment)');

    // Before any approval, no writes should have happened.
    assert.equal(providers.writeCalls.length, 0, 'NOTHING executes: zero writes pre-approval');

    // Verify intents carry expected tool names.
    const toolNames = pending.map((i) => i.toolCall.tool);
    assert.ok(toolNames.includes('atlassian-jira.updateItem') || toolNames.includes('atlassian-jira.comment'),
      'intents reference expected Jira tool names');
  } finally {
    globalThis.fetch = realFetch;
    rmTmpDir(rootDir);
  }
});
