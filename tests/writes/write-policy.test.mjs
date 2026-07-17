/**
 * tests/writes/write-policy.test.mjs — per-write-kind auto/approval/deny policy.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveWriteAuthorityKey,
  resolveWritePolicy,
  validateWritePolicyConfig,
  DEFAULT_WRITE_POLICY_MODE,
} from '../../lib/writes/write-policy.mjs';

test('resolveWriteAuthorityKey maps known governed writes to their authority key', () => {
  assert.equal(resolveWriteAuthorityKey('atlassian-jira', 'issue'), 'createIssues');
  assert.equal(resolveWriteAuthorityKey('atlassian-jira', 'issue-update'), 'updateIssues');
  assert.equal(resolveWriteAuthorityKey('atlassian-jira', 'comment'), 'updateIssues');
  assert.equal(resolveWriteAuthorityKey('github', 'pr'), 'repoWrites');
  assert.equal(resolveWriteAuthorityKey('atlassian-confluence', 'page'), 'publishDocs');
  assert.equal(resolveWriteAuthorityKey('slack', 'message'), 'externalPost');
  assert.equal(resolveWriteAuthorityKey('slack', 'reply'), 'externalPost');
});

test('resolveWriteAuthorityKey fails safe to externalPost for an unlisted kind', () => {
  assert.equal(resolveWriteAuthorityKey('atlassian-jira', 'some-future-kind'), 'externalPost');
  assert.equal(resolveWriteAuthorityKey('unknown-provider', 'x'), 'externalPost');
});

test('resolveWritePolicy defaults to approval when unconfigured', () => {
  assert.equal(resolveWritePolicy('atlassian-jira', 'issue', {}), DEFAULT_WRITE_POLICY_MODE);
  assert.equal(resolveWritePolicy('atlassian-jira', 'issue', undefined), 'approval');
});

test('resolveWritePolicy honors a configured mode', () => {
  const config = { writes: { policy: { 'atlassian-jira.comment': 'auto', 'github.issue': 'deny' } } };
  assert.equal(resolveWritePolicy('atlassian-jira', 'comment', config), 'auto');
  assert.equal(resolveWritePolicy('github', 'issue', config), 'deny');
  assert.equal(resolveWritePolicy('atlassian-jira', 'issue', config), 'approval', 'unconfigured tool falls back to default');
});

test('resolveWritePolicy fails safe on a malformed configured mode', () => {
  const config = { writes: { policy: { 'atlassian-jira.comment': 'yolo' } } };
  assert.equal(resolveWritePolicy('atlassian-jira', 'comment', config), 'approval');
});

test('validateWritePolicyConfig accepts a well-formed policy', () => {
  const result = validateWritePolicyConfig({ 'atlassian-jira.comment': 'auto', 'github.pr': 'deny' });
  assert.equal(result.ok, true);
});

test('validateWritePolicyConfig accepts an absent policy', () => {
  assert.deepEqual(validateWritePolicyConfig(undefined), { ok: true });
});

test('validateWritePolicyConfig rejects a non-object policy', () => {
  const result = validateWritePolicyConfig(['not', 'an', 'object']);
  assert.equal(result.ok, false);
});

test('validateWritePolicyConfig rejects an unknown provider', () => {
  const result = validateWritePolicyConfig({ 'notion.page': 'auto' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /not a known governed provider/);
});

test('validateWritePolicyConfig rejects an invalid mode', () => {
  const result = validateWritePolicyConfig({ 'atlassian-jira.comment': 'sometimes' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /mode must be one of/);
});
