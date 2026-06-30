/**
 * tests/asset-quality/presentation-lint.test.mjs — Isolated coverage for lintDocPresentation.
 *
 * The audit (subagents/source-presentation-lint.md) found the presentation linter only ran as a
 * release-gate side effect, never in isolation. These tests exercise it directly: the rules that
 * exist today are enforced, and the gaps it does not yet cover (unresolved placeholders, empty
 * sections) are pending construct-cuxq.2.2 so the coverage gap stays visible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintDocPresentation } from '../../lib/templates/doc-presentation.mjs';

const hasError = (body, needle, opts) => lintDocPresentation(body, opts).errors.some((e) => e.includes(needle));

test('flags multiple H1 titles', () => {
  assert.equal(hasError('# One\n\nprose.\n\n# Two\n\nprose.', 'multiple H1'), true);
});

test('flags a bullet wall over the prose-bridge limit', () => {
  const wall = '# Doc\n\n' + Array.from({ length: 9 }, (_, i) => `- item ${i}`).join('\n');
  assert.equal(hasError(wall, 'bullet wall'), true);
});

test('flags a heading glued to the prose above it', () => {
  assert.equal(hasError('# Doc\n\nIntro prose.\n## Next\n\nbody.', 'missing blank line before heading'), true);
});

test('flags an image with empty alt text', () => {
  assert.equal(hasError('# Doc\n\n![](diagram.png)\n\ncaption.', 'image missing alt text'), true);
});

test('a clean document raises no errors', () => {
  const clean = '# Title\n\nA real paragraph of prose that anchors the section.\n\n## Section\n\nMore prose here.';
  assert.deepEqual(lintDocPresentation(clean, {}).errors, []);
});

test('flags unresolved placeholders', () => {
  assert.equal(hasError('# Draft\n\nStatus: {{STATUS}}; owner TBD.', 'placeholder'), true);
});

test('flags empty sections', () => {
  assert.equal(hasError('# Spec\n\n## Goals\n\n## Risks\n\nreal prose.', 'empty section'), true);
});
