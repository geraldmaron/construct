/**
 * tests/orchestration/write-proposal-parser.test.mjs — parseWriteProposals
 * unit coverage (construct-p4cba.5).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseWriteProposals, WRITE_PROPOSAL_CLAUSE } from '../../lib/orchestration/write-proposal-parser.mjs';

test('returns an empty array for text with no proposal block', () => {
  assert.deepEqual(parseWriteProposals('just a plain answer, no writes recommended'), []);
});

test('returns an empty array for non-string input', () => {
  assert.deepEqual(parseWriteProposals(undefined), []);
  assert.deepEqual(parseWriteProposals(null), []);
  assert.deepEqual(parseWriteProposals(''), []);
});

test('extracts a single valid proposal block', () => {
  const text = [
    'Here is my recommendation:',
    '```write-proposal',
    '{"providerId": "jira", "writeKind": "comment", "payload": {"issueKey": "OPS-1", "body": "status update"}}',
    '```',
    'Let me know if that looks right.',
  ].join('\n');

  const proposals = parseWriteProposals(text, { requestedBy: { specialistId: 'operations' } });

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].providerId, 'jira');
  assert.equal(proposals[0].writeKind, 'comment');
  assert.deepEqual(proposals[0].payload, { issueKey: 'OPS-1', body: 'status update' });
  assert.equal(proposals[0].tool, 'jira.comment');
  assert.equal(proposals[0].requestedBy.specialistId, 'operations');
});

test('extracts multiple proposal blocks in one answer', () => {
  const text = [
    '```write-proposal',
    '{"providerId": "github", "writeKind": "pr", "payload": {"title": "t", "head": "b"}}',
    '```',
    'and also:',
    '```write-proposal',
    '{"providerId": "slack", "writeKind": "message", "payload": {"channel": "#ops", "text": "done"}}',
    '```',
  ].join('\n');

  const proposals = parseWriteProposals(text);
  assert.equal(proposals.length, 2);
  assert.equal(proposals[0].providerId, 'github');
  assert.equal(proposals[1].providerId, 'slack');
});

test('skips a malformed-JSON block without throwing', () => {
  const text = '```write-proposal\n{not valid json\n```';
  assert.deepEqual(parseWriteProposals(text), []);
});

test('skips a well-formed-JSON block with an invalid writeIntent shape', () => {
  const text = '```write-proposal\n{"providerId": "not-a-real-provider", "writeKind": "x", "payload": {}}\n```';
  assert.deepEqual(parseWriteProposals(text), []);
});

test('a valid block alongside a malformed one still yields the valid proposal', () => {
  const text = [
    '```write-proposal',
    '{broken',
    '```',
    '```write-proposal',
    '{"providerId": "jira", "writeKind": "issue", "payload": {"project": "OPS", "summary": "s"}}',
    '```',
  ].join('\n');

  const proposals = parseWriteProposals(text);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].providerId, 'jira');
});

test('defaults surface to specialist-recommendation when unset', () => {
  const text = '```write-proposal\n{"providerId": "jira", "writeKind": "comment", "payload": {"issueKey": "X-1", "body": "b"}}\n```';
  const [proposal] = parseWriteProposals(text);
  assert.equal(proposal.surface, 'specialist-recommendation');
});

test('WRITE_PROPOSAL_CLAUSE documents the exact fenced format the parser recognizes', () => {
  assert.match(WRITE_PROPOSAL_CLAUSE, /```write-proposal/);
  assert.match(WRITE_PROPOSAL_CLAUSE, /providerId/);
});
