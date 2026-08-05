/**
 * tests/kernel/run/synthesis.test.ts — numbered issues are extracted from
 * deliverable text, near-duplicates merge across roles with every role's
 * attribution kept, and genuinely different issues stay apart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractIssues,
  issueOverlap,
  mergeIssues,
  synthesizeIssues,
} from '../../../src/kernel/run/synthesis.ts';

test('numbered issues are extracted with continuation lines, stopping at blanks and headings', () => {
  const text = [
    '# finding',
    'Two problems stand out.',
    '1. The signup endpoint accepts unauthenticated requests.',
    '   Resolve: require a session token before accepting the form.',
    '',
    '2) Emails are stored without a retention policy.',
    'STANCE: hold',
  ].join('\n');
  const issues = extractIssues('security', text);
  assert.equal(issues.length, 2);
  assert.match(issues[0]!.text, /unauthenticated requests.*session token/);
  assert.match(issues[1]!.text, /retention policy/);
  assert.ok(!issues[1]!.text.includes('STANCE'));
});

test('a deliverable with no numbered lines contributes no issues', () => {
  assert.deepEqual(extractIssues('privacy', 'A paragraph with no numbering at all.'), []);
});

test('restated issues merge across roles, keeping both attributions and the first wording', () => {
  const merged = mergeIssues([
    { role: 'privacy', text: 'Stored customer emails need a retention policy before launch.' },
    { role: 'security', text: 'A retention policy for stored customer emails is missing.' },
    { role: 'security', text: 'The webhook endpoint lacks authentication entirely.' },
  ]);
  assert.equal(merged.length, 2);
  assert.match(merged[0]!.text, /^Stored customer emails/);
  assert.deepEqual(merged[0]!.roles, ['privacy', 'security']);
  assert.deepEqual(merged[1]!.roles, ['security']);
});

test('different issues in similar vocabulary stay apart', () => {
  const a = 'Encrypt customer emails at rest in the database.';
  const b = 'Delete customer emails when an account closes.';
  assert.ok(issueOverlap(a, b) < 0.5, `overlap ${issueOverlap(a, b)} should not merge`);
  assert.equal(mergeIssues([
    { role: 'security', text: a },
    { role: 'privacy', text: b },
  ]).length, 2);
});

test('the full pass extracts and merges across deliverables', () => {
  const merged = synthesizeIssues([
    { role: 'privacy', text: '1. Emails are kept forever; set a retention policy.' },
    { role: 'security', text: '1. Emails are kept forever with no retention policy set.\n2. No rate limit on signup.' },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0]!.roles, ['privacy', 'security']);
});
