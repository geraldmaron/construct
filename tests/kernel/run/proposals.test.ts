/**
 * tests/kernel/run/proposals.test.ts — a finished deliverable read as write
 * proposals.
 *
 * The properties held here are the ones that make the reading safe to act on:
 * only numbered issues and each composition shape's own follow-up section are
 * read, every proposal carries a citation that resolves to the line it came
 * from, the tier follows the action rather than the confidence, and a finding
 * whose words ask for nothing becomes a comment rather than an edit somebody
 * guessed at. An action's source is the same kind of property: a per-row
 * override always wins, a model's proposal is used only where nothing
 * overrode it, and with neither supplied the keyword read is byte for byte
 * what it always was.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionFor,
  findingsIn,
  proposalsFrom,
  proposeActionsWithModel,
  resolveFindingCitation,
  riskOfAction,
} from '../../../src/kernel/run/proposals.ts';
import type { Finding, WriteAction, WriteActionProposer } from '../../../src/kernel/run/proposals.ts';

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

/**
 * Every composition shape besides review names its follow-up section
 * differently (kernel/run/shapes.ts), and each one is read here in the words
 * that shape actually uses — not only review's "what follows".
 */
test('a decision-shaped deliverable is read from what-happens-first', () => {
  const decision = {
    task: 't-decision',
    role: 'analyst',
    text: [
      '## The choice',
      '',
      'Commit to the managed queue over the self-hosted one.',
      '',
      '## What happens first',
      '',
      '- Migrate the staging environment before touching production traffic.',
      '- Freeze the legacy queue schema until the migration finishes.',
      '',
    ].join('\n'),
  };
  const findings = findingsIn(decision);
  assert.deepEqual(findings.map((f) => f.kind), ['what-follows', 'what-follows']);
  assert.ok(findings.some((f) => f.text === 'Migrate the staging environment before touching production traffic.'));
});

test('a decision document reads what-happens-first and not its other sections', () => {
  const decision = {
    task: 't-decision-2',
    role: 'analyst',
    text: [
      '## What was on the table',
      '',
      '- The self-hosted queue, dismissed for its operational cost.',
      '',
      '## What happens first',
      '',
      '- Migrate the staging environment before touching production traffic.',
      '',
    ].join('\n'),
  };
  const findings = findingsIn(decision);
  assert.deepEqual(findings.map((f) => f.text), ['Migrate the staging environment before touching production traffic.']);
});

test('a spec-shaped deliverable is read from requirements', () => {
  const spec = {
    task: 't-spec',
    role: 'analyst',
    text: [
      '## Requirements',
      '',
      '1. The export must complete within five minutes for a 10k-row account.',
      '2. Retry a failed export once before surfacing an error to the user.',
      '',
    ].join('\n'),
  };
  const findings = findingsIn(spec);
  assert.deepEqual(findings.map((f) => f.kind), ['what-follows', 'what-follows']);
});

/**
 * "requirements" is an ordinary word a heading could carry without being the
 * spec shape's own section — the exact-match guard this module now uses over
 * the old substring check, proven against the case that would fool it.
 */
test('a heading merely containing the word "requirements" is not read as follow-up', () => {
  const notSpec = {
    task: 't-not-spec',
    role: 'analyst',
    text: [
      '## Non-functional requirements',
      '',
      '- The service should stay available during a single zone outage.',
      '',
    ].join('\n'),
  };
  const { proposals, refused } = proposalsFrom({ deliverable: notSpec, source: 'src-1', locator: 'PROJ' });
  assert.equal(proposals.length, 0);
  assert.equal(refused.length, 0);
});

test('an rfc-shaped deliverable is read from tradeoffs', () => {
  const rfc = {
    task: 't-rfc',
    role: 'analyst',
    text: [
      '## Tradeoffs',
      '',
      '- Adopting the managed queue raises the monthly bill by roughly 15 percent.',
      '- Change the on-call runbook once the managed queue replaces the self-hosted one.',
      '',
    ].join('\n'),
  };
  const findings = findingsIn(rfc);
  assert.deepEqual(findings.map((f) => f.kind), ['what-follows', 'what-follows']);
});

test('an adr-shaped deliverable is read from consequences', () => {
  const adr = {
    task: 't-adr',
    role: 'analyst',
    text: [
      '## Consequences',
      '',
      '- Update the deployment runbook to reference the new queue endpoint.',
      '- Retire the self-hosted queue cluster within one quarter of cutover.',
      '',
    ].join('\n'),
  };
  const findings = findingsIn(adr);
  assert.deepEqual(findings.map((f) => f.kind), ['what-follows', 'what-follows']);
});

/**
 * Onepager is deliberately absent from the mapping (see proposals.ts's module
 * doc): its reader approves or rejects one call rather than carrying out a
 * next step, so none of its sections read as follow-up material.
 */
test('a onepager-shaped deliverable has no follow-up section, so its bullets are not read', () => {
  const onepager = {
    task: 't-onepager',
    role: 'analyst',
    text: [
      '## What changes',
      '',
      '- The export button appears on every account page once this ships.',
      '- Support stops fielding manual export requests within a month.',
      '',
    ].join('\n'),
  };
  const { proposals, refused } = proposalsFrom({ deliverable: onepager, source: 'src-1', locator: 'PROJ' });
  assert.equal(proposals.length, 0);
  assert.equal(refused.length, 0);
});

/**
 * A composed document rendered with `--record` writes section headings as raw
 * slugs ("what-happens-first") rather than sentence case ("What happens
 * first"); both forms normalize the same way, so both are read the same way.
 */
test('a raw section slug heading matches the same as its rendered sentence-case form', () => {
  const decision = {
    task: 't-decision-slug',
    role: 'analyst',
    text: [
      '## what-happens-first',
      '',
      '- Migrate the staging environment before touching production traffic.',
      '',
    ].join('\n'),
  };
  const findings = findingsIn(decision);
  assert.deepEqual(findings.map((f) => f.kind), ['what-follows']);
});

test('with neither an override nor a model action supplied, every row reads as keyword — byte for byte what proposalsFrom always returned', () => {
  const bare = proposalsFrom({ deliverable: DELIVERABLE, source: 'src-1', locator: 'PROJ' });
  const withEmptyMaps = proposalsFrom({
    deliverable: DELIVERABLE,
    source: 'src-1',
    locator: 'PROJ',
    actionOverrides: new Map(),
    modelActions: new Map(),
  });
  assert.deepEqual(bare, withEmptyMaps);
  for (const proposal of bare.proposals) assert.equal(proposal.actionSource, 'keyword');
});

test('a per-row override wins outright, and every other row is untouched', () => {
  const { proposals } = proposalsFrom({
    deliverable: DELIVERABLE,
    source: 'src-1',
    locator: 'PROJ',
    actionOverrides: new Map([['wp-t-1-L7', 'label']]),
  });
  const overridden = proposals.find((p) => p.id === 'wp-t-1-L7');
  assert.equal(overridden?.action, 'label');
  assert.equal(overridden?.actionSource, 'override');
  assert.equal(overridden?.risk, riskOfAction('label'));
  // Nothing else moved: the same three actions the keyword path always gave.
  const others = proposals.filter((p) => p.id !== 'wp-t-1-L7').map((p) => p.action);
  assert.deepEqual(others, ['update', 'create', 'label']);
  for (const p of proposals.filter((p) => p.id !== 'wp-t-1-L7')) assert.equal(p.actionSource, 'keyword');
});

test('a model-proposed action is used when nothing overrode that row, and reports its source', () => {
  const { proposals } = proposalsFrom({
    deliverable: DELIVERABLE,
    source: 'src-1',
    locator: 'PROJ',
    modelActions: new Map([['wp-t-1-L7', 'create']]),
  });
  const proposed = proposals.find((p) => p.id === 'wp-t-1-L7');
  assert.equal(proposed?.action, 'create');
  assert.equal(proposed?.actionSource, 'model');
});

test('an override on a row beats a model action proposed for the same row', () => {
  const { proposals } = proposalsFrom({
    deliverable: DELIVERABLE,
    source: 'src-1',
    locator: 'PROJ',
    actionOverrides: new Map([['wp-t-1-L7', 'label']]),
    modelActions: new Map([['wp-t-1-L7', 'create']]),
  });
  const row = proposals.find((p) => p.id === 'wp-t-1-L7');
  assert.equal(row?.action, 'label');
  assert.equal(row?.actionSource, 'override');
});

test('proposeActionsWithModel asks the proposer for every finding and keys the answers by row id', async () => {
  const asked: string[] = [];
  const proposer: WriteActionProposer = async (finding: Finding) => {
    asked.push(finding.citation);
    return 'label';
  };
  const actions = await proposeActionsWithModel(DELIVERABLE, proposer);
  assert.deepEqual([...actions.entries()].sort(), [
    ['wp-t-1-L15', 'label'],
    ['wp-t-1-L16', 'label'],
    ['wp-t-1-L7', 'label'],
    ['wp-t-1-L8', 'label'],
  ]);
  assert.equal(asked.length, 4);
});

test('proposeActionsWithModel never asks about a row an override already named', async () => {
  const asked: string[] = [];
  const proposer: WriteActionProposer = async (finding: Finding) => {
    asked.push(finding.citation);
    return 'create';
  };
  const overrides = new Map<string, WriteAction>([['wp-t-1-L7', 'comment']]);
  const actions = await proposeActionsWithModel(DELIVERABLE, proposer, overrides);
  assert.ok(!asked.some((citation) => citation.endsWith('#L7')), 'the overridden row was never sent to the model');
  assert.ok(!actions.has('wp-t-1-L7'), 'the model map carries no answer for a row it was never asked about');
  assert.equal(actions.get('wp-t-1-L8'), 'create');
});

test('a finding the model declines to classify is left out of the map rather than guessed at', async () => {
  const proposer: WriteActionProposer = async (finding: Finding) => (finding.line === 7 ? null : 'update');
  const actions = await proposeActionsWithModel(DELIVERABLE, proposer);
  assert.ok(!actions.has('wp-t-1-L7'));
  assert.equal(actions.get('wp-t-1-L8'), 'update');
});
