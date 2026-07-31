/**
 * tests/audit/f13-artifact/required-renderer-soft-pass.red.mjs — F13 [R21] required-renderer soft-pass proof.
 *
 * RED fixture (must FAIL against current code). runOutputQuality treats EVERY tool-absence as a
 * typed degradation that "never fails the publish" (lib/output-quality.mjs L64-69): the failure
 * filter drops any check whose `degradation` is truthy. For a user-facing PDF/PPTX deliverable at a
 * render-smoke gate — the level publish.mjs forces on `--preview`, the moment a user inspects output
 * before claiming done — the required renderer being absent therefore degrades to an OK result
 * instead of failing. validatePdf (export-validate.mjs L20) and renderToImages (render-pipeline.mjs
 * L122) both return `degradation: 'missing-dependency'`, and captureRenderEvidence records it without
 * lifting the state, yet runOutputQuality still reports `ok: true`.
 *
 * Contract (002): a minimum quality tier keyed to the REQUESTED output type
 * must make the render-smoke check a hard requirement for a user-facing deliverable, so a missing
 * REQUIRED renderer fails rather than degrades. This test pins the current soft pass: it asserts the
 * result is NOT ok when a required PDF/PPTX renderer is absent for a render-smoke deliverable. It
 * passes once tool-absence on a required renderer stops being a free pass.
 *
 * Hermetic: a tmpdir export plus an empty PATH so the real `pdfinfo`/`pdftoppm`/`soffice` binaries
 * cannot resolve regardless of host. No host state is read or written.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runOutputQuality } from '../../../lib/output-quality.mjs';

const NO_TOOLS = { PATH: '/nonexistent-bin-dir-f13' };

function tmpExport(ext, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f13-rrsp-'));
  const file = path.join(dir, `deliverable.${ext}`);
  fs.writeFileSync(file, bytes);
  return { dir, file };
}

test('[R21] required PDF renderer absent for a render-smoke deliverable must FAIL, not degrade-to-pass', () => {
  const { dir, file } = tmpExport('pdf', '%PDF-1.4 placeholder bytes that pdfinfo cannot validate\n');
  try {
    const result = runOutputQuality({
      exportPath: file,
      format: 'pdf',
      sourceMarkdown: '# Doc\n\n## Problem\n\nbody\n',
      baseDir: dir,
      gateLevel: 'render-smoke',
      env: NO_TOOLS,
    });

    // Preconditions that make this a genuine required-renderer-absence scenario, not a bad test:
    // the validity probe and the render both degraded for the SAME missing-dependency reason.
    assert.equal(result.checks.pdf.degradation, 'missing-dependency', 'expected pdfinfo to be reported absent');
    assert.equal(
      result.render?.result?.degradation,
      'missing-dependency',
      'expected the render-smoke capture to report the renderer absent',
    );

    assert.equal(
      result.ok,
      false,
      'a user-facing PDF deliverable passed its render-smoke gate with the REQUIRED renderer absent — tool-absence soft-passed a quality claim',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[R21] required PPTX renderer absent for a render-smoke deliverable must FAIL, not degrade-to-pass', () => {
  const { dir, file } = tmpExport('pptx', 'PK placeholder pptx bytes\n');
  try {
    const result = runOutputQuality({
      exportPath: file,
      format: 'pptx',
      sourceMarkdown: '# Deck\n\n## Slide\n\nbody\n',
      baseDir: dir,
      gateLevel: 'render-smoke',
      env: NO_TOOLS,
    });

    assert.equal(
      result.render?.result?.degradation,
      'missing-dependency',
      'expected the pptx render-smoke capture to report soffice/pdftoppm absent',
    );

    assert.equal(
      result.ok,
      false,
      'a user-facing PPTX deliverable passed its render-smoke gate with the REQUIRED renderer absent',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
