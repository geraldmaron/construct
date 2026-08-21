/**
 * tests/kernel/run/triage.test.ts — inbound tracker issues read for likely
 * duplicates.
 *
 * The properties held here: similarity is read off significant title words,
 * not raw ones, so two titles sharing only stopwords never match; a later
 * issue matches at most one canonical, and it is always the first earlier
 * issue that clears the threshold, never a later one; the annotation pair
 * (label, comment) is proposed for every match and comes out low risk, while
 * the close-as-duplicate update is proposed only where the titles matched
 * outright and comes out high risk; and re-running triage over the same
 * issues proposes the same ids rather than doubling the queue.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicates, titleSimilarity, triageProposals } from '../../../src/kernel/run/triage.ts';
import type { TrackerIssue } from '../../../src/kernel/run/triage.ts';

test('identical titles are fully similar regardless of word order or case', () => {
  assert.equal(titleSimilarity('Dropdown menu closes unexpectedly', 'Dropdown menu closes unexpectedly'), 1);
  assert.equal(titleSimilarity('Search Results Page Is Blank', 'blank is search results page'), 1);
});

test('titles sharing no significant words are not similar at all', () => {
  assert.equal(titleSimilarity('Add dark mode toggle to settings', 'Export CSV report from dashboard'), 0);
});

test('titles sharing only stopwords do not count as similar', () => {
  assert.equal(titleSimilarity('The button is not working', 'This is not a bug'), 0);
});

test('titles sharing most of their significant words are similar without being exact', () => {
  const similarity = titleSimilarity(
    'Login page throws a 500 error on submit',
    'Login page throws 500 error when submitting the form',
  );
  assert.ok(similarity >= 0.6 && similarity < 1, `expected a near-duplicate similarity, got ${String(similarity)}`);
});

const NEAR_DUP: readonly TrackerIssue[] = [
  { id: 'PROJ-1', title: 'Login page throws a 500 error on submit' },
  { id: 'PROJ-2', title: 'Login page throws 500 error when submitting the form' },
];

const EXACT_DUP: readonly TrackerIssue[] = [
  { id: 'PROJ-10', title: 'Dropdown menu closes unexpectedly' },
  { id: 'PROJ-11', title: 'Dropdown menu closes unexpectedly' },
];

const UNRELATED: readonly TrackerIssue[] = [
  { id: 'PROJ-20', title: 'Add dark mode toggle to settings' },
  { id: 'PROJ-21', title: 'Export CSV report from dashboard' },
];

test('unrelated issues produce no match', () => {
  assert.deepEqual(findDuplicates(UNRELATED), []);
});

test('a chain of near-identical issues all collapse onto the first, never a later one', () => {
  const chain: TrackerIssue[] = [
    { id: 'iss-1', title: 'Dropdown menu closes unexpectedly' },
    { id: 'iss-2', title: 'Dropdown menu closes unexpectedly' },
    { id: 'iss-3', title: 'Dropdown menu closes unexpectedly' },
  ];
  const matches = findDuplicates(chain);
  assert.deepEqual(
    matches.map((m) => [m.issue.id, m.canonical.id]),
    [
      ['iss-2', 'iss-1'],
      ['iss-3', 'iss-1'],
    ],
  );
  assert.ok(matches.every((m) => m.exact));
});

test('a near duplicate proposes only the low-risk annotation pair, never a close', () => {
  const { proposals, matches } = triageProposals({ source: 'src-1', locator: 'PROJ', issues: NEAR_DUP });
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.exact, false);
  assert.deepEqual(
    proposals.map((p) => p.action),
    ['label', 'comment'],
  );
  assert.ok(proposals.every((p) => p.risk === 'low'));
  assert.ok(proposals.every((p) => p.source === 'src-1'));
  assert.match(proposals[0]?.change ?? '', /label issue PROJ-2 in PROJ: possible-duplicate/);
  assert.match(proposals[1]?.change ?? '', /comment on issue PROJ-2 in PROJ:.*duplicate of PROJ-1/);
  for (const proposal of proposals) {
    assert.match(proposal.justification, /PROJ-2/);
    assert.match(proposal.justification, /PROJ-1/);
  }
});

test('an exact duplicate additionally proposes a high-risk close, never auto-appliable by risk alone', () => {
  const { proposals, matches } = triageProposals({ source: 'src-1', locator: 'PROJ', issues: EXACT_DUP });
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.exact, true);
  assert.deepEqual(
    proposals.map((p) => [p.action, p.risk]),
    [
      ['label', 'low'],
      ['comment', 'low'],
      ['update', 'high'],
    ],
  );
  assert.match(
    proposals[2]?.change ?? '',
    /update issue PROJ-11 in PROJ: close as a duplicate of PROJ-10/,
  );
});

test('an issue with no duplicate proposes nothing', () => {
  const { proposals, matches } = triageProposals({ source: 'src-1', locator: 'PROJ', issues: UNRELATED });
  assert.deepEqual(proposals, []);
  assert.deepEqual(matches, []);
});

test('re-running triage over the same issues proposes the exact same ids', () => {
  const first = triageProposals({ source: 'src-1', locator: 'PROJ', issues: EXACT_DUP });
  const second = triageProposals({ source: 'src-1', locator: 'PROJ', issues: EXACT_DUP });
  assert.deepEqual(first.proposals.map((p) => p.id), second.proposals.map((p) => p.id));
});

test('the same issue against two different sources proposes two different ids', () => {
  const a = triageProposals({ source: 'src-a', locator: 'PROJ', issues: EXACT_DUP });
  const b = triageProposals({ source: 'src-b', locator: 'PROJ', issues: EXACT_DUP });
  assert.notEqual(a.proposals[0]?.id, b.proposals[0]?.id);
});
