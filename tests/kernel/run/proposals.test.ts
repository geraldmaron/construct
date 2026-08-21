/**
 * tests/kernel/run/proposals.test.ts — a finished deliverable read as write
 * proposals.
 *
 * The properties held here are the ones that make the reading safe to act on:
 * only numbered issues and what-follows items are read, every proposal carries
 * a citation that resolves to the line it came from, the tier follows the
 * action rather than the confidence, and a finding whose words ask for nothing
 * becomes a comment rather than an edit somebody guessed at.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionFor,
  findingsIn,
  proposalsFrom,
  resolveFindingCitation,
  riskOfAction,
} from '../../../src/kernel/run/proposals.ts';

const DELIVERABLE = {
  task: 't-1',
  role: 'analyst',
  text: [
    '# What the review found',
    '',
    'Two documents describe the same launch date without citing each other.',
    '',
    '## Issues',
    '',
    '1. The PRD promises SSO at launch while the strategy defers identity work to next year.',
    '2. Update the roadmap entry so it names the deferred quarter rather than "later".',
    '3. Scope',
    '',
    '- background reading: docs/prd.md, docs/strategy.md',
    '',
    '## What follows',
    '',
    '- File a ticket for the identity gap before the launch review. [analyst]',
    '- Flag the roadmap entry as contested until one of the two is amended.',
    '',
    '```',
    '1. this is sample text inside a fence, not a finding at all',
    '```',
    '',
  ].join('\n'),
};

test('only numbered issues and what-follows items are read as findings', () => {
  const findings = findingsIn(DELIVERABLE);
  assert.deepEqual(
    findings.map((f) => f.kind),
    ['numbered-issue', 'numbered-issue', 'what-follows', 'what-follows'],
  );
  // "3. Scope" is document furniture, the bullet outside the section is
  // evidence, and the fenced line is a sample.
  assert.ok(!findings.some((f) => /Scope|background reading|sample text/.test(f.text)));
  // The composed document's trailing attribution is not part of the finding.
  assert.ok(findings.some((f) => f.text === 'File a ticket for the identity gap before the launch review.'));
});

test('every finding cites a line of its own deliverable, and the line holds the words', () => {
  for (const finding of findingsIn(DELIVERABLE)) {
    const line = resolveFindingCitation(DELIVERABLE, finding.citation);
    assert.ok(line !== null, `${finding.citation} resolved to nothing`);
    assert.ok(line.includes(finding.text), `${finding.citation} does not hold "${finding.text}"`);
  }
});

test('a citation into a different deliverable, or past its end, resolves to nothing', () => {
  assert.equal(resolveFindingCitation(DELIVERABLE, 'deliverable:t-2#L7'), null);
  assert.equal(resolveFindingCitation(DELIVERABLE, 'deliverable:t-1#L900'), null);
  assert.equal(resolveFindingCitation(DELIVERABLE, 'note:n-1#L3'), null);
});

test('the tier follows the action: commenting and labelling are low, creating and updating high', () => {
  assert.equal(riskOfAction('comment'), 'low');
  assert.equal(riskOfAction('label'), 'low');
  assert.equal(riskOfAction('create'), 'high');
  assert.equal(riskOfAction('update'), 'high');
});

test('the action is read from the finding\'s own leading verb, hedges and all', () => {
  assert.equal(actionFor('File a ticket for the identity gap.'), 'create');
  assert.equal(actionFor('We should update the roadmap entry.'), 'update');
  assert.equal(actionFor('Flag the roadmap entry as contested.'), 'label');
  // A report is not an instruction, and the smallest true action is recording it.
  assert.equal(
    actionFor('The PRD promises SSO at launch while the strategy defers identity work.'),
    'comment',
  );
  // The verb has to lead. A finding about updating is not an instruction to update.
  assert.equal(actionFor('Nobody agreed to update the schema, which is the gap.'), 'comment');
});

test('each proposal carries the citation of the finding it came from as its justification', () => {
  const { proposals } = proposalsFrom({
    deliverable: DELIVERABLE,
    source: 'src-1',
    locator: 'PROJ',
  });
  assert.equal(proposals.length, 4);
  for (const proposal of proposals) {
    assert.equal(proposal.justification.startsWith(proposal.finding.citation), true);
    assert.ok(proposal.justification.includes(proposal.finding.text));
    assert.ok(proposal.justification.includes('analyst'));
    // The change names the source the way the person deciding knows it.
    assert.ok(proposal.change.includes('PROJ'));
    assert.equal(proposal.source, 'src-1');
    assert.equal(proposal.risk, riskOfAction(proposal.action));
  }
  const byAction = proposals.map((p) => p.action);
  assert.deepEqual(byAction, ['comment', 'update', 'create', 'label']);
  assert.deepEqual(
    proposals.map((p) => p.risk),
    ['low', 'high', 'high', 'low'],
  );
});

test('ids are derived from the deliverable and the line, so a second reading proposes the same rows', () => {
  const first = proposalsFrom({ deliverable: DELIVERABLE, source: 'src-1', locator: 'PROJ' });
  const second = proposalsFrom({ deliverable: DELIVERABLE, source: 'src-1', locator: 'PROJ' });
  assert.deepEqual(first.proposals.map((p) => p.id), second.proposals.map((p) => p.id));
  assert.deepEqual(first.proposals.map((p) => p.id), ['wp-t-1-L7', 'wp-t-1-L8', 'wp-t-1-L15', 'wp-t-1-L16']);
});

test('a finding repeated in one deliverable is refused rather than dropped in silence', () => {
  const repeated = {
    task: 't-9',
    role: 'analyst',
    text: [
      '## What follows',
      '',
      '- File a ticket for the identity gap before the launch review.',
      '- File a ticket for the identity gap before the launch review.',
      '',
    ].join('\n'),
  };
  const { proposals, refused } = proposalsFrom({
    deliverable: repeated,
    source: 'src-1',
    locator: 'PROJ',
  });
  assert.equal(proposals.length, 1);
  assert.equal(refused.length, 1);
  assert.match(refused[0].reason, /already proposed/);
});

test('a deliverable with no numbered issues and no what-follows section proposes nothing', () => {
  const prose = {
    task: 't-3',
    role: 'analyst',
    text: '# Finding\n\nThe two documents agree on every date they both state.\n',
  };
  const { proposals, refused } = proposalsFrom({ deliverable: prose, source: 'src-1', locator: 'PROJ' });
  assert.equal(proposals.length, 0);
  assert.equal(refused.length, 0);
});
