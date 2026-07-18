/**
 * tests/functional/governance-chokepoint-authority-ledger.functional.test.mjs
 * — construct-b0nny.15 (M2): the governed-write pipeline is the sole
 * authority chokepoint, and every authority decision behind it lands in one
 * shared ledger.
 *
 * Exercises the real modules end to end in an isolated tmpdir, faking only
 * the network-facing Jira transport (tests/fakes/fake-jira-transport.mjs): a
 * provider-write intent that reaches control-plane execution and an MCP
 * destructive-tool approval-token issue/consume both append to
 * lib/writes/authority-ledger.mjs's one JSONL store. Two bypass conditions
 * are asserted directly:
 *   1. lib/roles/approval-surface.mjs does not exist and no lib/ file imports it.
 *   2. A destructive tool call without a valid out-of-band token is rejected
 *      by the gate whose token issuance feeds the shared ledger — a write
 *      attempted outside the chokepoint never reaches the ledger as an
 *      approved decision.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { buildWriteIntent } from '../../lib/writes/write-intent.mjs';
import { executeApprovedWriteIntent } from '../../lib/writes/control-plane.mjs';
import { WriteSentLog } from '../../lib/writes/sent-log.mjs';
import { listAuthorityEvents } from '../../lib/writes/authority-ledger.mjs';
import { createGovernedJiraProvider } from '../../lib/providers/contract/adapters/jira/governed-write.mjs';
import { createFakeJiraTransport } from '../fakes/fake-jira-transport.mjs';
import { checkDestructiveGate } from '../../lib/mcp/destructive-gate.mjs';
import { issueApprovalToken } from '../../lib/mcp/destructive-approval.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let tmpRoot;
let prevDoctorRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-authority-ledger-'));
  prevDoctorRoot = process.env.CONSTRUCT_DOCTOR_ROOT;
  process.env.CONSTRUCT_DOCTOR_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-authority-ledger-doctor-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (prevDoctorRoot === undefined) delete process.env.CONSTRUCT_DOCTOR_ROOT;
  else process.env.CONSTRUCT_DOCTOR_ROOT = prevDoctorRoot;
});

function jiraFactories(transport) {
  return { jira: () => createGovernedJiraProvider({ jiraTransport: transport }) };
}

describe('construct-b0nny.15 — roles/approval-surface.mjs is deleted with zero remaining callers', () => {
  it('the file no longer exists on disk', () => {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'lib/roles/approval-surface.mjs')), false);
  });

  it('no source file under lib/ imports roles/approval-surface.mjs', () => {
    const offenders = [];
    const importLine = /^\s*import\b.*roles\/approval-surface(\.mjs)?['"]/;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.mjs')) {
          const hasImport = fs.readFileSync(full, 'utf8').split('\n').some((line) => importLine.test(line));
          if (hasImport) offenders.push(path.relative(REPO_ROOT, full));
        }
      }
    };
    walk(path.join(REPO_ROOT, 'lib'));
    assert.deepEqual(offenders, [], `expected zero lib/ importers of roles/approval-surface.mjs, found:\n${offenders.join('\n')}`);
  });
});

describe('construct-b0nny.15 — one authority ledger for both provider-write and destructive-token decisions', () => {
  it('a provider-write intent executed by control-plane and an MCP destructive-token issue+consume both land in the same ledger file', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'queue.jsonl') });
    const sentLog = new WriteSentLog({ persistPath: path.join(tmpRoot, 'sent-log.jsonl') });

    const intent = buildWriteIntent({
      providerId: 'jira',
      writeKind: 'issue',
      payload: { project: 'PROJ', issueType: 'Task', summary: 'Ledger reconciliation proof' },
      requestedBy: { specialistId: 'qa-analyst' },
      surface: 'specialist-recommendation',
    });
    const record = queue.enqueue({ tool: intent.tool, args: intent.payload, surface: intent.surface, requestedBy: intent.requestedBy });
    queue.approve(record.approvalId, { decidedBy: { userId: 'reviewer-1' } });

    const result = await executeApprovedWriteIntent(queue.getById(record.approvalId), {
      adapterFactories: jiraFactories(transport),
      sentLog,
      rootDir: tmpRoot,
    });
    assert.equal(result.status, 'sent');

    // A destructive MCP tool token issued and then consumed against the gate
    // — the same authority mechanism a real dispatch-envelope call gates on.
    const token = issueApprovalToken('storage_reset', { rootDir: tmpRoot });
    const gateResult = checkDestructiveGate('storage_reset', { confirm: true, approval_token: token }, { rootDir: tmpRoot });
    assert.equal(gateResult.allowed, true);

    const events = listAuthorityEvents({ rootDir: tmpRoot });
    const providerWriteEvents = events.filter((e) => e.kind === 'provider-write');
    const destructiveTokenEvents = events.filter((e) => e.kind === 'destructive-token');

    assert.ok(providerWriteEvents.length >= 1, 'expected at least one provider-write ledger entry');
    assert.ok(
      destructiveTokenEvents.some((e) => e.decision === 'issued'),
      'expected a destructive-token "issued" ledger entry',
    );
    assert.ok(
      destructiveTokenEvents.some((e) => e.decision === 'consumed'),
      'expected a destructive-token "consumed" ledger entry',
    );
    assert.equal(providerWriteEvents[0].scope, 'jira.issue');
    assert.equal(destructiveTokenEvents.find((e) => e.decision === 'issued').scope, 'storage_reset');
  });
});

describe('construct-b0nny.15 — a write attempted outside the chokepoint is rejected', () => {
  it('a destructive tool call without a valid out-of-band token never reaches "allowed" and never grants a bypassed write', () => {
    const bypassAttempt = checkDestructiveGate('storage_reset', { confirm: true }, { rootDir: tmpRoot });
    assert.equal(bypassAttempt.allowed, false);
    assert.match(bypassAttempt.reason, /approval token/);

    // No token was ever issued in this test, so no "issued" ledger entry exists
    // to have been forged or replayed — the rejection produced no authority record.
    const events = listAuthorityEvents({ rootDir: tmpRoot });
    assert.deepEqual(events.filter((e) => e.kind === 'destructive-token'), []);
  });

  it('executeApprovedWriteIntent refuses a record that has not been approved (only the control-plane chokepoint may reach the envelope)', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const queue = new ApprovalQueue({ persistPath: path.join(tmpRoot, 'queue.jsonl') });
    const intent = buildWriteIntent({
      providerId: 'jira',
      writeKind: 'issue',
      payload: { project: 'PROJ', issueType: 'Task', summary: 'Should never execute' },
      requestedBy: { specialistId: 'qa-analyst' },
      surface: 'specialist-recommendation',
    });
    const record = queue.enqueue({ tool: intent.tool, args: intent.payload, surface: intent.surface, requestedBy: intent.requestedBy });

    await assert.rejects(
      () => executeApprovedWriteIntent(record, { adapterFactories: jiraFactories(transport), rootDir: tmpRoot }),
      /only 'approved' records may reach the envelope/,
    );
    assert.equal(transport.createIssueCallCount(), 0);

    // The refused attempt must not have appended a false "approved" ledger entry.
    const events = listAuthorityEvents({ rootDir: tmpRoot });
    assert.deepEqual(events.filter((e) => e.kind === 'provider-write'), []);
  });
});
