/**
 * tests/asset-quality/render-degradation.test.mjs — Guards typed render degradation.
 *
 * A render/export step that cannot run must degrade with a typed, surfaced reason — never a
 * silent skip that reads as success (consolidated-findings §3). This locks the current typed
 * surface (document-export detect(): missing[] + present flag + install-hint message) and marks
 * the still-silent paths (diagram engine fallback, headless Chrome) pending the beads that make
 * them typed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../../lib/document-export.mjs';

const NO_TOOLING_ENV = { PATH: '/nonexistent-bin-dir' };

test('detect() reports missing renderers as typed degradation, not a silent pass', () => {
  const result = detect('pdf', NO_TOOLING_ENV, {});
  assert.equal(result.present, false);
  assert.ok(Array.isArray(result.missing) && result.missing.length > 0, 'missing[] must name the absent binaries');
  assert.ok(result.missing.includes('typst') || result.missing.includes('pandoc'));
  assert.ok(typeof result.message === 'string' && result.message.length > 0, 'message must carry an install hint');
});

test('detect() rejects an unsupported format with a typed message, not a silent ok', () => {
  const result = detect('not-a-format', NO_TOOLING_ENV, {});
  assert.equal(result.ok, false);
  assert.match(result.message, /Unsupported format/i);
});

test('detect() enumerates each required binary with a name', () => {
  const result = detect('pdf', NO_TOOLING_ENV, {});
  assert.ok(Array.isArray(result.binaries));
  for (const binary of result.binaries) {
    assert.ok(typeof binary.name === 'string' && binary.name.length > 0);
  }
});

test('diagram engine failure surfaces a typed warning instead of leaving raw source', { skip: 'enforced by construct-cuxq.6.2' }, () => {});

test('missing headless Chrome names chrome as the blocker, not just mmdc', { skip: 'enforced by construct-cuxq.3.2' }, () => {});

test('every render path emits a typed degradation reason from the fixed enum', { skip: 'enforced by construct-cuxq.3.2' }, () => {});
