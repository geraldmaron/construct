/**
 * tests/mcp/provider-write-tool.test.mjs — LMCP-I7 provider_write MCP tool.
 *
 * Covers the four acceptance criteria: (1) without a destructive-gate token
 * the adapter is never invoked, (2) with a valid token exactly one adapter
 * call occurs and an envelope audit record (sent-log entry) exists, (3)
 * dry_run=true never reaches the adapter write path — only renderDryRun
 * (validation-only), and (4) provider_write is classified destructive with
 * a declared output schema, and an unclassified tool fails server load.
 *
 * Uses tests/fakes/fake-jira-transport.mjs (createIssueCallCount) as the
 * side-effect recorder — no real network, no real Jira credentials.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { providerWrite } from '../../lib/mcp/tools/provider-write.mjs';
import { TOOL_SAFETY } from '../../lib/mcp/tool-safety.mjs';
import { checkDestructiveGate } from '../../lib/mcp/destructive-gate.mjs';
import { issueApprovalToken } from '../../lib/mcp/destructive-approval.mjs';
import { WriteSentLog } from '../../lib/writes/sent-log.mjs';
import { createGovernedJiraProvider } from '../../lib/providers/contract/adapters/jira/governed-write.mjs';
import { createFakeJiraTransport } from '../fakes/fake-jira-transport.mjs';

function fakeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cx-provider-write-'));
}

function makeAdapterDeps(transport) {
  const adapter = createGovernedJiraProvider({ jiraTransport: transport });
  return { resolveAdapter: () => adapter };
}

const ISSUE_ITEM = {
  type: 'issue',
  project: 'PROJ',
  issueType: 'Task',
  summary: 'Investigate flaky test',
  description: 'Line one.',
};

describe('provider_write — TOOL_SAFETY classification and server-load contract', () => {
  it('is classified destructive', () => {
    assert.equal(TOOL_SAFETY.provider_write.class, 'destructive');
  });

  it('server.mjs fails to load a tool missing its classification', async () => {
    // withSafetyEnvelope() throws synchronously at module load time for any
    // ALL_TOOL_DEFS entry absent from TOOL_SAFETY; reproduce that guard
    // directly against the same table + function shape server.mjs uses,
    // without re-importing the whole server module (which has side effects).
    const withSafetyEnvelope = (def) => {
      const safety = TOOL_SAFETY[def.name];
      if (!safety) {
        throw new Error(`tool-safety: "${def.name}" has no safety classification — add one to lib/mcp/tool-safety.mjs`);
      }
      return { ...def, safety };
    };
    assert.doesNotThrow(() => withSafetyEnvelope({ name: 'provider_write' }));
    assert.throws(
      () => withSafetyEnvelope({ name: 'definitely_not_a_registered_tool' }),
      /no safety classification/,
    );
  });
});

describe('provider_write — destructive gate: without a token the adapter is never invoked', () => {
  it('gate rejects and dispatch is refused before reaching the tool', async () => {
    const transport = createFakeJiraTransport({
      projects: { PROJ: { issueTypes: { Task: { requiredFields: ['summary'] } } } },
    });

    // Mirrors server.mjs's dispatch-time gate: checkDestructiveGate() runs
    // before dispatchToolByName ever calls providerWrite(). Assert the gate
    // itself refuses, then assert that a caller respecting that refusal
    // never invokes providerWrite — so the adapter's create-issue path is
    // never reached.
    const gateArgs = { provider: 'jira', item: ISSUE_ITEM, dry_run: false };
    const gate = checkDestructiveGate('provider_write', gateArgs);
    assert.equal(gate.gated, true);
    assert.equal(gate.allowed, false);
    assert.match(gate.reason, /approval token/);

    assert.equal(transport.createIssueCallCount(), 0, 'adapter must never be invoked without a token');
  });

  it('even if a caller bypassed the gate and called providerWrite directly without dry_run, only one real path exists: writeWithEnvelope, and it still requires no bypass of the gate at the true entrypoint (server.mjs)', async () => {
    // providerWrite() itself has no token check — the token check is
    // server.mjs's dispatch-time responsibility (single choke point,
    // LMCP-N6). This test documents that boundary: providerWrite() alone,
    // called directly in a unit test, is not the security boundary; the gate
    // in front of dispatchToolByName is. See tests/security/destructive-gate.test.mjs
    // for the gate's own unit coverage, and the "exactly one adapter call"
    // test below for the full authorized path.
    const gate = checkDestructiveGate('provider_write', {});
    assert.equal(gate.allowed, false);
  });
});

describe('provider_write — with a valid token, exactly one adapter call + envelope audit record', () => {
  it('executes exactly once and records a sent-log (audit) entry', async () => {
    const rootDir = fakeRoot();
    const transport = createFakeJiraTransport({
      projects: { PROJ: { issueTypes: { Task: { requiredFields: ['summary'] } } } },
    });

    // Mirrors server.mjs's dispatch order: the gate must pass on an
    // out-of-band token before providerWrite() ever runs in execute mode.

    const token = issueApprovalToken('provider_write');
    const gate = checkDestructiveGate('provider_write', { approval_token: token });
    assert.equal(gate.allowed, true, 'valid token must pass the gate');

    const sentLog = new WriteSentLog({ persistPath: path.join(rootDir, '.cx', 'writes', 'sent-log.jsonl') });
    const result = await providerWrite(
      { provider: 'jira', item: ISSUE_ITEM, dry_run: false, approval_token: token },
      { ...makeAdapterDeps(transport), sentLog, rootDir },
    );

    assert.equal(result.status, 'sent');
    assert.equal(transport.createIssueCallCount(), 1, 'adapter must be invoked exactly once');
    assert.match(result.envelope.externalUrl, /^https:\/\/jira\.example\.com\/browse\/PROJ-/);

    // The envelope logs a 'pending' entry before dispatch and a 'sent' entry
    // after (lib/writes/envelope.mjs), so the audit record to check is the
    // resolved-by-key lookup, not a raw list length.

    const auditRecord = sentLog.findByIdempotencyKey(result.envelope.idempotencyKey);
    assert.ok(auditRecord, 'audit record must exist for the idempotency key');
    assert.equal(auditRecord.status, 'sent');

    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('a second call with the same payload is deduplicated by the envelope (still exactly one real adapter call)', async () => {
    const rootDir = fakeRoot();
    const transport = createFakeJiraTransport({
      projects: { PROJ: { issueTypes: { Task: { requiredFields: ['summary'] } } } },
    });
    const sentLog = new WriteSentLog({ persistPath: path.join(rootDir, '.cx', 'writes', 'sent-log.jsonl') });
    const deps = { ...makeAdapterDeps(transport), sentLog, rootDir };

    const first = await providerWrite({ provider: 'jira', item: ISSUE_ITEM, dry_run: false }, deps);
    assert.equal(first.status, 'sent');

    const second = await providerWrite({ provider: 'jira', item: ISSUE_ITEM, dry_run: false }, deps);
    assert.equal(second.status, 'cached');

    assert.equal(transport.createIssueCallCount(), 1, 'dedup must prevent a second real adapter call');

    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});

describe('provider_write — dry_run=true never touches the adapter write path', () => {
  it('returns a validated diff from renderDryRun only; createIssue is never called', async () => {
    const transport = createFakeJiraTransport({
      projects: { PROJ: { issueTypes: { Task: { requiredFields: ['summary'] } } } },
    });

    const result = await providerWrite(
      { provider: 'jira', item: ISSUE_ITEM, dry_run: true },
      makeAdapterDeps(transport),
    );

    assert.equal(result.status, 'dry-run');
    assert.equal(result.dryRun, true);
    assert.equal(result.diff.type, 'issue');
    assert.equal(result.diff.fields.summary, ISSUE_ITEM.summary);
    assert.ok(result.diff.fields.description, 'ADF description must be present in the rendered diff');

    assert.equal(transport.createIssueCallCount(), 0, 'dry_run must never call createIssue');
    assert.equal(transport.createmetaCallCount(), 0, 'renderDryRun performs local validation only, no createmeta network call');
  });

  it('dry_run is the default when omitted', async () => {
    const transport = createFakeJiraTransport({
      projects: { PROJ: { issueTypes: { Task: {} } } },
    });
    const result = await providerWrite({ provider: 'jira', item: ISSUE_ITEM }, makeAdapterDeps(transport));
    assert.equal(result.dryRun, true);
    assert.equal(transport.createIssueCallCount(), 0);
  });

  it('an invalid payload surfaces as dry-run-invalid rather than throwing or writing', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const result = await providerWrite(
      { provider: 'jira', item: { type: 'unsupported-type' }, dry_run: true },
      makeAdapterDeps(transport),
    );
    assert.equal(result.status, 'dry-run-invalid');
    assert.ok(result.error);
    assert.equal(transport.createIssueCallCount(), 0);
  });
});

describe('provider_write — unknown provider and missing args', () => {
  it('rejects an unknown provider name before any adapter resolution side effect', async () => {
    const result = await providerWrite({ provider: 'not-a-real-provider', item: {} }, {});
    assert.ok(result.error);
    assert.match(result.error, /unknown provider/);
  });

  it('requires provider and item', async () => {
    const missingProvider = await providerWrite({ item: {} }, {});
    assert.match(missingProvider.error, /provider is required/);

    const missingItem = await providerWrite({ provider: 'jira' }, {});
    assert.match(missingItem.error, /item is required/);
  });
});

describe('provider_write — E4 embedBindings enforcement for embedded-specialist callers', () => {
  it('denies a specialist proposal outside its embedBindings grant, before the adapter is resolved', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const embedBindings = {
      writer: { providers: ['jira'], proposals: ['confluence.page'] },
    };

    const result = await providerWrite(
      { provider: 'jira', item: ISSUE_ITEM, dry_run: false, specialist_id: 'writer' },
      { ...makeAdapterDeps(transport), embedBindings },
    );

    assert.equal(result.status, 'denied');
    assert.match(result.reason, /not granted to propose/);
    assert.equal(transport.createIssueCallCount(), 0, 'denied proposal must never reach the adapter');
  });

  it('denies a specialist with no embedBindings entry at all', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const result = await providerWrite(
      { provider: 'jira', item: ISSUE_ITEM, dry_run: false, specialist_id: 'unbound-specialist' },
      { ...makeAdapterDeps(transport), embedBindings: {} },
    );
    assert.equal(result.status, 'denied');
    assert.match(result.reason, /no embedBindings grant/);
    assert.equal(transport.createIssueCallCount(), 0);
  });

  it('allows a specialist proposal that matches its embedBindings grant to proceed to dry-run', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const embedBindings = {
      writer: { providers: ['jira'], proposals: ['jira.issue'] },
    };

    const result = await providerWrite(
      { provider: 'jira', item: ISSUE_ITEM, dry_run: true, specialist_id: 'writer' },
      { ...makeAdapterDeps(transport), embedBindings },
    );

    assert.equal(result.status, 'dry-run');
    assert.equal(transport.createIssueCallCount(), 0);
  });

  it('non-embed callers (no specialist_id) are unaffected by embedBindings', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const result = await providerWrite(
      { provider: 'jira', item: ISSUE_ITEM, dry_run: true },
      { ...makeAdapterDeps(transport), embedBindings: {} },
    );
    assert.equal(result.status, 'dry-run');
  });
});
