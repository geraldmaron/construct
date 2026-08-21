/**
 * The boundary between the record and the reader.
 *
 * The property these tests exist to hold is that rendering is a view: the
 * stored text keeps every marker and every gate keeps reading them, and only
 * the copy a person receives changes. A rendering that quietly weakened what a
 * marker meant would be the softening the markers exist to prevent, wearing a
 * house style.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderAttribution,
  renderClaim,
  renderComposedClaim,
  renderDocument,
  renderHeading,
} from '../../../src/kernel/run/publish.ts';
import { runStructuralChallenges } from '../../../src/kernel/challenge/catalog.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const BRIEF: Brief = {
  id: 't-privacy',
  outcome: 'Decide what to fund over the next two releases',
  role: 'privacy',
  inputs: [],
  capabilities: [],
  postconditions: [],
  challenges: ['claims-cited'],
};

test('an unverified tag becomes a request for the work it names', () => {
  const rendered = renderClaim('Four source captures exist against a 95% bar [unverified].');

  assert.doesNotMatch(rendered, /\[unverified\]/);
  assert.match(rendered, /still needs checking against a source/);
});

test('an unowned marker names the gap as something somebody must do', () => {
  const rendered = renderClaim('The canonical-write reauth gap [unowned] blocks the beta gate.');

  assert.doesNotMatch(rendered, /\[unowned\]/);
  assert.match(rendered, /nobody is named for this yet/);
});

test('a citation reads the way a colleague gives one', () => {
  const rendered = renderClaim(
    'Registry entries default to disabled [cite:/Users/g/blackstory/docs/research/audit.md].',
  );

  assert.doesNotMatch(rendered, /\[cite:/);
  assert.match(rendered, /\(research\/audit\.md\)/);
});

test('an assumption is rendered as one, not as a field', () => {
  const rendered = renderClaim('The switches moved [assumed: Firestore is no longer the read path].');

  assert.match(rendered, /taking it that Firestore is no longer the read path/);
});

/**
 * Rendered text carries no markers, so rendering it again changes nothing. A
 * surface that re-renders on a redraw would otherwise accumulate clauses until
 * the sentence stopped being one.
 */
test('rendering twice is rendering once', () => {
  const once = renderClaim('Four captures exist [unverified] per the bar [cite:docs/ops/bar.md].');

  assert.equal(renderClaim(once), once);
});

/**
 * The whole design rests on this. If rendering happened on the way in, the
 * citation gate would stop seeing the tag it counts, and the check would pass
 * on prose that no longer says what it said.
 */
test('the record the gates read is untouched by what the reader is shown', () => {
  const recorded = 'The bar is 95% [unverified] and four captures exist [unverified].';

  const before = runStructuralChallenges(BRIEF, recorded);
  renderClaim(recorded);
  const after = runStructuralChallenges(BRIEF, recorded);

  assert.deepEqual(before.results, after.results);
  assert.equal(before.results[0].passed, true);
});

/**
 * And the converse, which is why this is a publish-time view and not a
 * migration: rendered text would not survive the gate, because the marker the
 * gate counts is exactly what rendering removes.
 */
test('rendered text is not what a gate should ever be handed', () => {
  const rendered = renderClaim('The bar is 95% [unverified].');

  assert.equal(runStructuralChallenges(BRIEF, rendered).results[0].passed, false);
});

test('a section slug becomes a sentence, not Title Case', () => {
  assert.equal(renderHeading('what-would-change-it'), 'What would change it');
  assert.equal(renderHeading('the-choice'), 'The choice');
});

test('a concern id becomes the English it already was', () => {
  assert.equal(renderAttribution('evidence-provenance'), 'evidence provenance');
});

/**
 * A deliverable is a document, not a sentence. Its markers render the way a
 * claim's do; the structure a reader depends on — indentation, nested lists,
 * blank lines, fenced code — does not get flattened on the way out, which is
 * what renderClaim's whitespace tidying would have done to it.
 */
test('a whole deliverable renders its markers and keeps its shape', () => {
  const stored = [
    '## finding',
    'The retention window is 90 days [cite:docs/policy/retention.md].',
    '',
    '1. Rotate the export key [unowned].',
    '   - the current key was issued in March [unverified].',
    '',
    '```',
    'retention: [unverified]',
    '```',
  ].join('\n');

  const rendered = renderDocument(stored);
  const lines = rendered.split('\n');

  assert.equal(lines.length, stored.split('\n').length, 'a line is a line: nothing is joined or dropped');
  assert.equal(lines[2], '', 'blank lines survive');
  assert.match(lines[1], /\(policy\/retention\.md\)/);
  assert.match(lines[3], /nobody is named for this yet/);
  assert.ok(lines[4].startsWith('   - '), 'a nested list stays nested');
  assert.match(lines[4], /still needs checking against a source/);
  // Fenced content is what somebody wrote, including a marker they were
  // quoting: rendering it would edit the thing they were showing.
  assert.equal(lines[7], 'retention: [unverified]');
});

test('rendering a deliverable is a view, and the stored text is untouched', () => {
  const stored = 'The window is 90 days [unverified].';
  assert.match(renderDocument(stored), /still needs checking/);
  assert.equal(stored, 'The window is 90 days [unverified].', 'a view, never a migration');
});

/**
 * A composed document is not bullets by structural necessity — the render
 * function was the thing forcing every claim through `- text [role]`
 * regardless of kind. These hold that a table actually becomes a markdown
 * table, a diagram actually becomes a mermaid fence, and a paragraph reads
 * as prose rather than a bullet with an unusually long sentence in it.
 */
test('a bullet renders exactly as it always did', () => {
  const rendered = renderComposedClaim(
    { section: 's', text: 'the pilot ships in Q4', from: 'product-scoping', kind: 'bullet' },
    false,
  );
  assert.equal(rendered, '- the pilot ships in Q4 [product scoping]');
});

test('a paragraph renders as prose with a byline, not a bullet', () => {
  const rendered = renderComposedClaim(
    { section: 's', text: 'First this happened. Then that followed because of it.', from: 'strategy-alignment', kind: 'paragraph' },
    false,
  );
  assert.doesNotMatch(rendered, /^-/);
  assert.match(rendered, /First this happened\. Then that followed because of it\./);
  assert.match(rendered, /strategy alignment/);
});

test('a table renders as an actual markdown table, headers and all rows', () => {
  const rendered = renderComposedClaim(
    {
      section: 's',
      text: 'Two vendors compared on cost.',
      from: 'product-scoping',
      kind: 'table',
      table: { headers: ['vendor', 'cost'], rows: [['Acme', '$10k'], ['Beta', '$8k']] },
    },
    false,
  );
  assert.match(rendered, /\| vendor \| cost \|/);
  assert.match(rendered, /\| --- \| --- \|/);
  assert.match(rendered, /\| Acme \| \$10k \|/);
  assert.match(rendered, /\| Beta \| \$8k \|/);
});

test('a diagram renders as a fenced mermaid block, source untouched', () => {
  const rendered = renderComposedClaim(
    { section: 's', text: 'graph TD\nA[gap] --> B[fix]', from: 'strategy-alignment', kind: 'diagram' },
    false,
  );
  assert.match(rendered, /```mermaid\ngraph TD\nA\[gap\] --> B\[fix\]\n```/);
});

test('a table with no table data renders nothing rather than a broken grid', () => {
  const rendered = renderComposedClaim(
    { section: 's', text: 'a caption with no data', from: 'product-scoping', kind: 'table' },
    false,
  );
  assert.equal(rendered, '');
});

test('--record form leaves markers and role ids unrendered, same as a bullet already did', () => {
  const rendered = renderComposedClaim(
    { section: 's', text: 'the finding [unverified]', from: 'product-scoping', kind: 'paragraph' },
    true,
  );
  assert.match(rendered, /\[unverified\]/);
  assert.match(rendered, /product-scoping/);
});
