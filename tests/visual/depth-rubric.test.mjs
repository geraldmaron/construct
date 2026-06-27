/**
 * tests/visual/depth-rubric.test.mjs — unit tests for output-depth scoring.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureDepth, countSkillSignals, stripAnsi } from './lib/depth-rubric.mjs';
import { getRoleExpectation } from './lib/role-expectations.mjs';

test('stripAnsi removes OSC-8 sequences', () => {
  const raw = 'see \x1b]8;;file:///tmp/a.md\x07docs/foo.md\x1b]8;;\x07';
  assert.equal(stripAnsi(raw).includes('\x1b'), false);
  assert.match(stripAnsi(raw), /docs\/foo\.md/);
});

test('countSkillSignals detects workflow references', () => {
  const n = countSkillSignals('Follow docs/prd-workflow and run construct artifact validate', [
    'docs/prd-workflow',
  ]);
  assert.ok(n >= 2);
});

test('researcher rubric requires citations or unverified discipline', () => {
  const role = getRoleExpectation('researcher');
  const bad = measureDepth('Intake is important.', {
    ...role.depthRubric,
    expectedSkills: role.expectedSkills,
  });
  const good = measureDepth(
    'See docs/guides/concepts/intake-and-triage.mdx for taxonomy. Confidence: high for path; [unverified] for volume metrics.',
    { ...role.depthRubric, expectedSkills: role.expectedSkills },
  );
  assert.equal(bad.ok, false);
  assert.ok(good.score > bad.score);
});
