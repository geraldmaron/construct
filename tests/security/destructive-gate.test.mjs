/**
 * tests/security/destructive-gate.test.mjs — destructive-tool gate unit tests.
 *
 * @owasp LLM06
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDestructiveGate } from '../../lib/mcp/destructive-gate.mjs';
import { issueApprovalToken } from '../../lib/mcp/destructive-approval.mjs';

test('non-destructive tool passes through', () => {
  const result = checkDestructiveGate('agent_health', {});
  assert.deepStrictEqual(result, { gated: false, allowed: true });
});

test('destructive tool without token rejected', () => {
  const result = checkDestructiveGate('storage_reset', { confirm: true });
  assert.deepStrictEqual(result.gated, true);
  assert.deepStrictEqual(result.allowed, false);
  assert.ok(result.reason.includes('approval token'));
});

test('destructive tool with valid token allowed', () => {
  const token = issueApprovalToken('storage_reset');
  const result = checkDestructiveGate('storage_reset', { confirm: true, approval_token: token });
  assert.deepStrictEqual(result, { gated: true, allowed: true });
});

test('token single-use — same token consumed twice fails second time', () => {
  const token = issueApprovalToken('storage_reset');
  const first = checkDestructiveGate('storage_reset', { confirm: true, approval_token: token });
  assert.deepStrictEqual(first.allowed, true);

  const second = checkDestructiveGate('storage_reset', { confirm: true, approval_token: token });
  assert.deepStrictEqual(second.gated, true);
  assert.deepStrictEqual(second.allowed, false);
  assert.ok(second.reason.includes('approval token'));
});

test('unknown tool name falls through safely', () => {
  const result = checkDestructiveGate('nonexistent_tool', {});
  assert.deepStrictEqual(result, { gated: false, allowed: true });
});

test('scope_archive now requires token via gate', () => {
  const result = checkDestructiveGate('scope_archive', { id: 'test', reason: 'test archival' });
  assert.deepStrictEqual(result.gated, true);
  assert.deepStrictEqual(result.allowed, false);
  assert.ok(result.reason.includes('approval token'));
});

test('call gateway delegates to inner tool — gate checks inner classification', () => {
  const result = checkDestructiveGate('storage_reset', {});
  assert.deepStrictEqual(result.gated, true);
  assert.deepStrictEqual(result.allowed, false);

  const token = issueApprovalToken('storage_reset');
  const passed = checkDestructiveGate('storage_reset', { approval_token: token });
  assert.deepStrictEqual(passed, { gated: true, allowed: true });
});
