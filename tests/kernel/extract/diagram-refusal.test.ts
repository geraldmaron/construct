/**
 * tests/kernel/extract/diagram-refusal.test.ts — vector/diagram formats have
 * no rung at all, not merely an unavailable one, and the plan says so
 * explicitly rather than folding the gap into the generic "convert to
 * PDF/DOCX/text/email" message, which is not a path a diagram has.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExtraction } from '../../../src/kernel/extract/ladder.ts';
import { DIAGRAM_EXTS } from '../../../src/kernel/extract/formats.ts';

test('a diagram format is planned with zero steps and a diagram-specific refusal', () => {
  for (const extension of DIAGRAM_EXTS) {
    const plan = planExtraction({ extension, doclingLocalAvailable: true, syncExtractAvailable: true });
    assert.equal(plan.steps.length, 0, `${extension} must have no runnable rung, even with Docling available`);
    assert.equal(plan.unavailable, null);
    assert.ok(plan.exhausted, `${extension} must state why nothing can be tried`);
    assert.match(plan.exhausted!.reason, new RegExp(extension.replace('.', '\\.')));
    assert.match(plan.exhausted!.reason, /No rung reads it/);
    assert.doesNotMatch(
      plan.exhausted!.reason,
      /Unsupported document type/,
      'a diagram gets its own honest reason, not the generic unsupported-type template',
    );
    assert.doesNotMatch(
      plan.exhausted!.remediation,
      /PDF, DOCX, plain text, or email/,
      'the generic remediation is not a path a vector diagram has',
    );
  }
});

test('an image format still has a rung — Docling, when available — unlike a diagram', () => {
  const withDocling = planExtraction({ extension: '.png', doclingLocalAvailable: true });
  assert.equal(withDocling.steps.length, 1);
  assert.equal(withDocling.steps[0]!.tier, 'docling-local');

  const withoutDocling = planExtraction({ extension: '.png', doclingLocalAvailable: false });
  assert.equal(withoutDocling.steps.length, 0);
  assert.match(withoutDocling.exhausted!.reason, /\.png has no lightweight parser; Docling is unavailable/);
});
