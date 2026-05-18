/**
 * tests/handoff-contract.test.mjs — contract parse/validate/format round-trip.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHandoff, validateHandoff, formatHandoff, HANDOFF_SCHEMA_VERSION } from '../lib/handoffs/contract.mjs';

test('parseHandoff extracts frontmatter and sections from v1 handoff', () => {
  const text = [
    '---',
    `schema: ${HANDOFF_SCHEMA_VERSION}`,
    'id: 2026-05-18-test',
    'created: 2026-05-18T00:00:00.000Z',
    'beads: [construct-abc, construct-def]',
    'status: open',
    'title: Test handoff',
    '---',
    '',
    '## What was done',
    '',
    'Wrote tests.',
    '',
    "## What's left",
    '',
    'Ship it.',
  ].join('\n');

  const parsed = parseHandoff(text);
  assert.equal(parsed.status, 'open');
  assert.equal(parsed.frontmatter.schema, HANDOFF_SCHEMA_VERSION);
  assert.deepEqual(parsed.frontmatter.beads, ['construct-abc', 'construct-def']);
  assert.equal(parsed.sections['What was done'], 'Wrote tests.');
  assert.equal(parsed.sections["What's left"], 'Ship it.');
});

test('parseHandoff returns legacy status for pre-contract handoffs', () => {
  const text = '# Old handoff\n\nSome notes.\n';
  const parsed = parseHandoff(text);
  assert.equal(parsed.status, 'legacy');
  assert.deepEqual(parsed.frontmatter, {});
});

test('validateHandoff rejects missing required fields', () => {
  const parsed = parseHandoff('---\nschema: cx-handoff/v1\n---\n\nNo sections.\n');
  const { valid, errors } = validateHandoff(parsed);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('id required')));
  assert.ok(errors.some((e) => e.includes('title required')));
  assert.ok(errors.some((e) => e.includes('What was done')));
});

test('validateHandoff accepts well-formed handoff', () => {
  const text = formatHandoff({
    id: '2026-05-18-complete',
    title: 'Complete handoff',
    beads: ['construct-xyz'],
    whatWasDone: 'Everything.',
    whatsLeft: 'Nothing.',
  });
  const parsed = parseHandoff(text);
  const { valid, errors } = validateHandoff(parsed);
  assert.equal(valid, true, `Unexpected errors: ${errors.join(', ')}`);
});

test('formatHandoff produces parseable output', () => {
  const formatted = formatHandoff({
    id: 'round-trip',
    title: 'Round trip test',
    beads: ['construct-a', 'construct-b'],
    status: 'resolved',
    tags: ['test'],
    whatWasDone: 'Did stuff.',
    whatsLeft: 'More stuff.',
    openQuestions: 'None.',
    howToResume: 'Just start.',
  });
  const parsed = parseHandoff(formatted);
  assert.equal(parsed.frontmatter.id, 'round-trip');
  assert.equal(parsed.frontmatter.status, 'resolved');
  assert.equal(parsed.status, 'resolved');
  assert.deepEqual(parsed.frontmatter.beads, ['construct-a', 'construct-b']);
  assert.deepEqual(parsed.frontmatter.tags, ['test']);
  assert.equal(parsed.sections['How to resume'], 'Just start.');
});

test('parseHandoff handles non-string input gracefully', () => {
  const parsed = parseHandoff(null);
  assert.equal(parsed.status, 'invalid');
  assert.ok(parsed.error);
});
