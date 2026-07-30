/**
 * tests/acceptance/tpm-preset.acceptance.test.mjs — golden-fixture acceptance
 * for the `operations` embed preset (the flagship TPM scenario).
 *
 * @embed operations
 *
 * Drives the real embed capability tick (runCapabilityTick) with an injected
 * deterministic TPM reasoningExecutor over a seeded snapshot built from the J1
 * fake providers (Jira + Confluence + Slack). Asserts the four acceptance
 * criteria with re-verifiable evidence:
 *
 *   1. A seeded PRD/Jira mismatch produces the expected missing-work finding
 *      and a draft writeIntent in the approval queue — and NOTHING executes:
 *      a side-effect recorder proves zero adapter writes happened during the
 *      tick.
 *   2. A seeded slipping dependency chain produces a timeline-risk finding
 *      that cites its evidence (issue keys + due dates).
 *   3. The briefing packet validates against its output contract and every
 *      load-bearing claim carries provenance (a source id).
 *   4. Enable → briefing → approval → (fake) issue creation runs end to end:
 *      after the operator approves the queued intent, draining it through the
 *      governed write envelope creates exactly the proposed issue in FakeJira.
 *
 * A global fetch guard fires if any code path reaches for real network I/O.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeJira, FakeConfluence, FakeSlack } from '../fakes/index.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { runCapabilityTick } from '../../lib/embed/capability-jobs.mjs';
import { createTpmReasoningExecutor, analyzeTpm } from '../../lib/embed/presets/tpm.mjs';
import { writeWithEnvelope } from '../../lib/writes/envelope.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const realFetch = globalThis.fetch;

// Seeded fixture: three requirements, two covered, one (REQ-3) deliberately
// uncovered; a blocked issue whose blocker is due after it (a slipping chain);
// a Slack message that descopes REQ-3 (a contradiction against the PRD).

const PRD_BODY = [
  'REQ-1: Users can pay with a saved card',
  'REQ-2: Refunds are issued within 30 days',
  'REQ-3: Guest checkout without an account',
].join('\n');

const JIRA_ISSUES = [
  { key: 'PAY-1', summary: 'Card payment implementation for REQ-1', status: 'In Progress', dueDate: '2026-08-01' },
  { key: 'PAY-2', summary: 'Refund flow REQ-2', status: 'Blocked', dueDate: '2026-07-20', blockedBy: ['PAY-9'] },
  { key: 'PAY-9', summary: 'Payment gateway upgrade', status: 'To Do', dueDate: '2026-07-25' },
];

const SLACK_MESSAGES = [
  { id: 'msg-100', channel: '#payments', text: 'Heads up: REQ-3 guest checkout is descoped for this release.' },
];

// The shipped core-pack manifest declares runtime "auto"; the fixture pins
// "in-process" so the tick is deterministic in a hermetic tmpdir with no
// ambient model provider configured — runtime selection is covered elsewhere.
const OPERATIONS_MANIFEST = {
  id: 'operations',
  version: '1.0.0',
  type: 'embed',
  workerProfiles: [],
  approvalMode: 'proposal-only',
  modelTier: 'standard',
  state: 'active',
  embed: {
    workerProfileId: 'operations',
    providerBindings: ['atlassian-jira', 'atlassian-confluence', 'slack'],
    framework: 'operations-dependency-sequencing',
    proposalAuthority: 'propose-only',
    runtime: 'in-process',
    cadence: { every: 'PT4H' },
  },
};

// The bare-role embedBindings map the tick's AuthorityGuard consults: the
// operations specialist may propose exactly the Jira createIssue write.
const EMBED_BINDINGS = {
  operations: {
    providers: [
      { id: 'atlassian-jira', capabilities: ['read', 'search'] },
      { id: 'atlassian-confluence', capabilities: ['read', 'search'] },
      { id: 'slack', capabilities: ['read', 'search'] },
    ],
    proposals: ['atlassian-jira.createIssue'],
  },
};

const FIXED_NOW = Date.parse('2026-07-03T00:00:00.000Z');

function buildSeededSnapshot() {
  return {
    sections: [
      { provider: 'atlassian-confluence', refs: ['PROD'], items: [{ id: 'PRD-checkout', title: 'Checkout PRD', body: PRD_BODY }] },
      { provider: 'atlassian-jira', refs: ['PAY'], items: JIRA_ISSUES },
      { provider: 'slack', refs: ['#payments'], items: SLACK_MESSAGES },
    ],
  };
}

// A recording provider registry: wraps the fakes and counts every write() call
// so the test can prove zero adapter writes happened during the tick.
function recordingProviders() {
  const jira = FakeJira();
  const confluence = FakeConfluence();
  const slack = FakeSlack();
  const writeCalls = [];

  for (const [id, p] of [['atlassian-jira', jira], ['atlassian-confluence', confluence], ['slack', slack]]) {
    const original = p.write.bind(p);
    p.write = async (config, payload) => {
      writeCalls.push({ provider: id, payload });
      return original(config, payload);
    };
  }
  return { jira, confluence, slack, writeCalls };
}

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'tpm-preset-'));
}

function assertTpmPacketContract(packet) {
  assert.deepEqual(
    Object.keys(packet).sort(),
    ['briefing', 'coverageMatrix', 'misalignment', 'missingWork', 'proposals', 'provenance', 'timelineRisks'],
    'Procedure artifact exposes the complete TPM briefing packet',
  );
  assert.equal(typeof packet.briefing, 'string');
  for (const section of ['coverageMatrix', 'missingWork', 'timelineRisks', 'misalignment', 'proposals', 'provenance']) {
    assert.equal(typeof packet[section].count, 'number', `${section} declares a count`);
  }
}

test('seeded PRD/Jira mismatch → missing-work finding + queued draft intent, zero adapter writes', async () => {
  globalThis.fetch = () => { throw new Error('Real network blocked in acceptance test'); };
  const rootDir = tmpRoot();
  try {
    const providers = recordingProviders();
    const approvalQueue = new ApprovalQueue({ persistPath: join(rootDir, 'queue.jsonl') });
    const executor = createTpmReasoningExecutor({ now: FIXED_NOW });

    const tick = await runCapabilityTick(OPERATIONS_MANIFEST, {
      rootDir,
      env: process.env,
      getSnapshot: () => buildSeededSnapshot(),
      approvalQueue,
      embedBindings: EMBED_BINDINGS,
      reasoningExecutor: executor,
    });

    assert.equal(tick.status, 'ran', `tick should run, got ${tick.status} (${tick.reason ?? ''})`);
    assert.equal(tick.contractStatus, 'unchecked', 'final Procedure artifacts are not Assignment handoffs');

    assert.equal(tick.proposalsEnqueued.length, 1, 'exactly one draft ticket enqueued');
    assert.equal(tick.proposalsEnqueued[0].providerId, 'atlassian-jira');
    assert.equal(tick.proposalsEnqueued[0].writeKind, 'createIssue');

    const queued = approvalQueue.list('awaiting_approval');
    assert.equal(queued.length, 1, 'one intent awaiting approval');
    assert.equal(queued[0].toolCall.tool, 'atlassian-jira.createIssue');
    assert.match(queued[0].toolCall.args.summary, /REQ-3/, 'draft targets the uncovered REQ-3');

    assert.equal(providers.writeCalls.length, 0, 'NOTHING executes: zero provider adapter writes during the tick');
    assert.equal(providers.jira.getCreatedIssues().length, 0, 'no Jira issue created without approval');
  } finally {
    globalThis.fetch = realFetch;
    rmTmpDir(rootDir);
  }
});

test('seeded slipping dependency chain → timeline-risk finding citing its evidence', () => {
  const { analysis } = analyzeTpm(buildSeededSnapshot().sections, { now: FIXED_NOW });
  const slipping = analysis.timelineRisks.find((r) => r.kind === 'slipping-chain');

  assert.ok(slipping, 'a slipping-chain timeline risk is found');
  assert.equal(slipping.issueKey, 'PAY-2');
  assert.equal(slipping.evidence.blocker, 'PAY-9');
  assert.equal(slipping.evidence.issueDueDate, '2026-07-20');
  assert.equal(slipping.evidence.blockerDueDate, '2026-07-25');
  assert.match(slipping.statement, /PAY-2.*PAY-9/, 'the finding cites both issue keys');
});

test('briefing satisfies its Procedure artifact shape; every load-bearing claim carries provenance', () => {
  const { outputPacket, analysis, briefing } = analyzeTpm(buildSeededSnapshot().sections, { now: FIXED_NOW });

  assertTpmPacketContract(outputPacket);

  for (const finding of analysis.missingWork.findings) {
    assert.ok(finding.evidence.requirement, 'missing-work finding cites the requirement provenance');
    assert.match(finding.statement, /source /, 'missing-work statement carries a source id');
  }
  for (const risk of analysis.timelineRisks) {
    assert.ok(risk.evidence.issue, 'timeline risk cites its issue');
    assert.match(risk.statement, /source/, 'timeline-risk statement carries a source id');
  }
  for (const signal of analysis.slackSignals) {
    assert.ok(signal.evidence.message, 'slack signal cites its message id');
  }

  assert.ok(analysis.provenance.length > 0, 'provenance index is populated');
  assert.match(briefing, /## Provenance index/, 'briefing carries a provenance index');
  assert.match(briefing, /REQ-3.*NOT COVERED/s, 'uncovered requirement is named in the briefing');
});

test('enable → briefing → approval → (fake) ticket creation runs end to end', async () => {
  globalThis.fetch = () => { throw new Error('Real network blocked in acceptance test'); };
  const rootDir = tmpRoot();
  try {
    const providers = recordingProviders();
    const approvalQueue = new ApprovalQueue({ persistPath: join(rootDir, 'queue.jsonl') });
    const executor = createTpmReasoningExecutor({ now: FIXED_NOW });

    await runCapabilityTick(OPERATIONS_MANIFEST, {
      rootDir,
      getSnapshot: () => buildSeededSnapshot(),
      approvalQueue,
      embedBindings: EMBED_BINDINGS,
      reasoningExecutor: executor,
    });

    const pending = approvalQueue.list('awaiting_approval');
    assert.equal(pending.length, 1, 'one intent awaiting approval before execution');
    assert.equal(providers.jira.getCreatedIssues().length, 0, 'nothing created pre-approval');

    // Operator approves; only then does the governed write envelope drain the
    // intent through the provider adapter — the fake issue is created here.
    const approved = approvalQueue.approve(pending[0].approvalId, { decidedBy: { userId: 'operator' } });
    assert.equal(approved.state, 'approved');

    const result = await writeWithEnvelope({
      provider: providers.jira,
      config: { projectKey: 'PAY' },
      payload: { ...approved.toolCall.args, projectKey: 'PAY' },
    });

    assert.equal(result.status, 'sent', `envelope write should send, got ${result.status}`);
    const created = providers.jira.getCreatedIssues();
    assert.equal(created.length, 1, 'exactly one fake ticket created post-approval');
    assert.match(created[0].summary, /REQ-3/, 'the created ticket is the one that was proposed');
    assert.equal(providers.writeCalls.filter((c) => c.provider === 'atlassian-jira').length, 1, 'exactly one Jira adapter write, and only after approval');
  } finally {
    globalThis.fetch = realFetch;
    rmTmpDir(rootDir);
  }
});
