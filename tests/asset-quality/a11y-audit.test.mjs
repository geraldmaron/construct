/**
 * tests/asset-quality/a11y-audit.test.mjs — Guards per-format accessibility checks (cuxq.8.1).
 *
 * Each format runs its declared checks and the report honestly separates checked from
 * uncheckable: alt text and heading hierarchy are source-checkable everywhere, contrast is
 * checkable for HTML/deck but listed uncheckable for PDF/PPTX, and a missing tool degrades.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditAccessibility, FORMAT_A11Y } from '../../lib/a11y-audit.mjs';

function byId(result, id) {
  return result.results.find((r) => r.id === id);
}

test('a clean HTML document passes its declared a11y checks', () => {
  const source = '---\ntitle: Doc\n---\n\n## Problem\n\n![a chart](chart.png)\n\n### Detail\n\ntext\n';
  const result = auditAccessibility({ format: 'html', sourceMarkdown: source });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.equal(byId(result, 'alt_text').status, 'pass');
  assert.equal(byId(result, 'heading_hierarchy').status, 'pass');
  assert.equal(byId(result, 'contrast').status, 'pass');
});

test('missing alt text fails the alt_text check', () => {
  const source = '## Problem\n\n![](chart.png)\n';
  const result = auditAccessibility({ format: 'html', sourceMarkdown: source });
  assert.equal(result.ok, false);
  assert.equal(byId(result, 'alt_text').status, 'fail');
});

test('a skipped heading level fails heading_hierarchy', () => {
  const source = '## Problem\n\n#### Too deep\n';
  const result = auditAccessibility({ format: 'html', sourceMarkdown: source });
  assert.equal(byId(result, 'heading_hierarchy').status, 'fail');
});

test('a frontmatter-titled doc starting at h2 is well-formed', () => {
  const source = '## Problem\n\n### Detail\n\n## Goals\n';
  assert.equal(byId(auditAccessibility({ format: 'html', sourceMarkdown: source }), 'heading_hierarchy').status, 'pass');
});

test('PDF lists rendered-text contrast as uncheckable, never a false pass', () => {
  const result = auditAccessibility({ format: 'pdf', sourceMarkdown: '## X\n', exportPath: null, env: { PATH: '/nonexistent' } });
  assert.ok(!result.coverage.checked.some((c) => c.id === 'contrast'));
  assert.ok(result.coverage.uncheckable.some((u) => u.id === 'contrast'));
  const extract = byId(result, 'text_extractable');
  assert.equal(extract.status, 'degraded');
  assert.equal(extract.degradation, 'missing-dependency');
});

test('every export format declares an a11y spec', () => {
  for (const format of ['html', 'deck', 'pptx', 'pdf', 'docx']) {
    assert.ok(FORMAT_A11Y[format], `missing a11y spec for ${format}`);
    assert.ok(FORMAT_A11Y[format].checks.length > 0);
  }
});
