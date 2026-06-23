/**
 * tests/export-branding.test.mjs — distribution branding policy coverage.
 *
 * Style-capable formats default to Construct branding; source formats remain plain.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_FORMATS } from '../lib/document-export.mjs';
import { EXPORT_BRANDING_CAPABILITIES, resolveExportBranding } from '../lib/export-branding.mjs';

test('default export branding covers every styling-capable distribution format', () => {
  for (const format of EXPORT_FORMATS) {
    const policy = resolveExportBranding(format);
    assert.equal(policy.capable, Boolean(EXPORT_BRANDING_CAPABILITIES[format]?.capable), format);
    if (policy.capable) assert.equal(policy.applied, 'construct', format);
  }
});

test('explicit plain branding opts out without misrepresenting source formats', () => {
  assert.equal(resolveExportBranding('pdf', 'plain').applied, 'plain');
  assert.equal(resolveExportBranding('pptx', 'plain').applied, 'plain');
  assert.equal(resolveExportBranding('md', 'plain').applied, 'none');
});
