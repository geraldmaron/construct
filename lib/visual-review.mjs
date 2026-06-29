/**
 * lib/visual-review.mjs — Rubric registry and the visually-reviewed evidence contract.
 *
 * A visual review is recordable only from a real captured screenshot, a named rubric, and a
 * reviewer verdict — never inferred from source text. recordVisualReview throws unless it is handed
 * screenshot-captured evidence with no degradation, so the visually-reviewed rung cannot be forged
 * without a rendered image. The verdict rides in the proof and gates the later approved rung; the
 * review itself (model or human judgment) is supplied by the caller, not fabricated here.
 */
import { makeEvidence } from './artifact-completion.mjs';

export const VERDICTS = Object.freeze(['pass', 'needs-changes', 'fail']);

export const RUBRICS = Object.freeze({
  'document-v1': {
    id: 'document-v1',
    applies: ['pdf', 'docx', 'html'],
    criteria: ['spacing and visual rhythm', 'visual hierarchy and scan-ability', 'reading order sanity'],
  },
  'deck-v1': {
    id: 'deck-v1',
    applies: ['pptx', 'deck'],
    criteria: ['slide density', 'font legibility at slide distance', 'no clipped or overflowing content'],
  },
  'diagram-v1': {
    id: 'diagram-v1',
    applies: ['mermaid', 'd2'],
    criteria: ['purpose is clear', 'labels are readable', 'density is manageable', 'non-happy path shown where relevant'],
  },
});

export function makeVisualReview({ rubricId, image, verdict, reviewer, notes = '' } = {}) {
  if (!RUBRICS[rubricId]) {
    throw new Error(`unknown rubric: ${rubricId} (expected one of ${Object.keys(RUBRICS).join(', ')})`);
  }
  if (typeof image !== 'string' || image.length === 0) {
    throw new Error('visual review requires a rendered image path');
  }
  if (!VERDICTS.includes(verdict)) {
    throw new Error(`unknown verdict: ${verdict} (expected one of ${VERDICTS.join(', ')})`);
  }
  if (typeof reviewer !== 'string' || reviewer.length === 0) {
    throw new Error('visual review requires a reviewer');
  }
  return Object.freeze({ rubricId, image, verdict, reviewer, notes });
}

// The review must trace to a real captured screenshot; handing in anything else (a degraded
// render, or no evidence at all) throws, so visually-reviewed is unreachable from source alone.

export function recordVisualReview({ screenshotEvidence, review, actor = 'construct-review' } = {}) {
  if (!screenshotEvidence
    || screenshotEvidence.state !== 'screenshot-captured'
    || screenshotEvidence.degradation) {
    throw new Error('visual review requires non-degraded screenshot-captured evidence (no source inference)');
  }
  if (!review || !RUBRICS[review.rubricId] || !VERDICTS.includes(review.verdict)) {
    throw new Error('visual review requires a valid review report');
  }
  return makeEvidence('visually-reviewed', {
    actor,
    artifact: screenshotEvidence.artifact,
    proof: {
      rubricId: review.rubricId,
      image: review.image,
      verdict: review.verdict,
      reviewer: review.reviewer,
    },
  });
}
