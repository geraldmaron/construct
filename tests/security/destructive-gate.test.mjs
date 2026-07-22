/**
 * tests/security/destructive-gate.test.mjs — destructive-tool gate unit tests.
 *
 * @owasp LLM06
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';
import { checkDestructiveGate } from '../../lib/mcp/destructive-gate.mjs';
import { issueApprovalToken } from '../../lib/mcp/destructive-approval.mjs';

// issueApprovalToken/consumeApprovalToken resolve doctorRoot() from
// process.env at call time, so redirecting CONSTRUCT_DOCTOR_ROOT here keeps
// every token this file issues off the real machine's XDG state dir. The
// same tmpdir doubles as `rootDir` for the shared authority ledger
// (lib/writes/authority-ledger.mjs, construct-b0nny.15) so a successful
// issue/consume in this file never appends to the real project's
// .construct/writes/authority-ledger.jsonl.

let testRoot;

test.before(() => {
  testRoot = tempDir('cx-destructive-gate-');
  process.env.CONSTRUCT_DOCTOR_ROOT = testRoot;
});

test('non-destructive tool passes through', () => {
  const result = checkDestructiveGate('agent_health', {});
  assert.deepStrictEqual(result, { gated: false, allowed: true });
});

test('destructive tool without token rejected', () => {
  const result = checkDestructiveGate('storage_reset', { confirm: true }, { rootDir: testRoot });
  assert.deepStrictEqual(result.gated, true);
  assert.deepStrictEqual(result.allowed, false);
  assert.ok(result.reason.includes('approval token'));
});

test('destructive tool with valid token allowed', () => {
  const token = issueApprovalToken('storage_reset', { rootDir: testRoot });
  const result = checkDestructiveGate('storage_reset', { confirm: true, approval_token: token }, { rootDir: testRoot });
  assert.deepStrictEqual(result, { gated: true, allowed: true });
});

test('token single-use — same token consumed twice fails second time', () => {
  const token = issueApprovalToken('storage_reset', { rootDir: testRoot });
  const first = checkDestructiveGate('storage_reset', { confirm: true, approval_token: token }, { rootDir: testRoot });
  assert.deepStrictEqual(first.allowed, true);

  const second = checkDestructiveGate('storage_reset', { confirm: true, approval_token: token }, { rootDir: testRoot });
  assert.deepStrictEqual(second.gated, true);
  assert.deepStrictEqual(second.allowed, false);
  assert.ok(second.reason.includes('approval token'));
});

test('unknown tool name falls through safely', () => {
  const result = checkDestructiveGate('nonexistent_tool', {});
  assert.deepStrictEqual(result, { gated: false, allowed: true });
});

test('workspace_preset_archive requires token via gate', () => {
  const result = checkDestructiveGate('workspace_preset_archive', { id: 'test', reason: 'test archival' }, { rootDir: testRoot });
  assert.deepStrictEqual(result.gated, true);
  assert.deepStrictEqual(result.allowed, false);
  assert.ok(result.reason.includes('approval token'));
});

test('call gateway delegates to inner tool — gate checks inner classification', () => {
  const result = checkDestructiveGate('storage_reset', {}, { rootDir: testRoot });
  assert.deepStrictEqual(result.gated, true);
  assert.deepStrictEqual(result.allowed, false);

  const token = issueApprovalToken('storage_reset', { rootDir: testRoot });
  const passed = checkDestructiveGate('storage_reset', { approval_token: token }, { rootDir: testRoot });
  assert.deepStrictEqual(passed, { gated: true, allowed: true });
});
