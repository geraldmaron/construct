/**
 * tests/audit/f13-artifact/invisible-overlapping-text.red.mjs — F13 [R21] visual-gate blind-spot proof.
 *
 * RED fixture (must FAIL against current code). The output-quality pass has no visual-regression
 * check: lib/output-quality.mjs validates page count, a text roundtrip, on-disk references, brand
 * palette, and (at render-smoke) merely CAPTURES screenshots — it never inspects the rendered pixels
 * or the produced markup for invisible or overlapping text. lib/a11y-audit.mjs declares rendered-text
 * contrast `uncheckable` for pdf/pptx/docx (FORMAT_A11Y L24-26), so zero-opacity, white-on-white, or
 * absolutely-positioned overlapping text in a USER-FACING deliverable sails through with `ok: true`.
 * The text roundtrip even REWARDS invisible text: the hidden glyphs are still extractable, so the key
 * phrases "survive" and the check passes.
 *
 * Contract (CX-AUDIT-ARTIFACT-003): clipping/overlap/contrast must be caught by a visual-regression
 * gate on the produced artifact. Because pixel rendering is too heavy for a hermetic unit, this test
 * drives an HTML deliverable whose own markup encodes the defect (opacity:0 and a hard overlap of two
 * absolutely-positioned text blocks) and asserts runOutputQuality FAILS. Today it passes — proving the
 * blind spot. It flips green once a visual/markup gate flags invisible and overlapping text.
 *
 * Hermetic: a tmpdir HTML export; the HTML path needs no external tool, so this is deterministic on
 * any host. No host state is touched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runOutputQuality } from '../../../lib/output-quality.mjs';

function tmpHtml(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f13-iot-'));
  const file = path.join(dir, 'deliverable.html');
  fs.writeFileSync(file, body);
  return { dir, file };
}

test('[R21] invisible (opacity:0) body text in a user-facing deliverable must be CAUGHT by the visual gate', () => {
  const invisible = [
    '<html><body>',
    '<h1>Doc</h1>',
    '<h2>Problem</h2>',
    '<p style="opacity:0">the entire problem statement is rendered invisible</p>',
    '<h2>Goals</h2>',
    '<p style="color:#ffffff;background:#ffffff">white-on-white, unreadable in the rendered output</p>',
    '</body></html>',
  ].join('');
  const { dir, file } = tmpHtml(invisible);
  try {
    const source = '# Doc\n\n## Problem\n\np\n\n## Goals\n\np\n';
    const result = runOutputQuality({ exportPath: file, format: 'html', sourceMarkdown: source, baseDir: dir, gateLevel: 'standard' });

    assert.equal(
      result.ok,
      false,
      'a deliverable whose body text is invisible (opacity:0 / white-on-white) passed the quality gate',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[R21] hard-overlapping absolutely-positioned text in a user-facing deliverable must be CAUGHT', () => {
  const overlap = [
    '<html><body>',
    '<h1>Doc</h1>',
    '<div style="position:absolute;top:40px;left:0;width:300px">Problem heading text block</div>',
    '<div style="position:absolute;top:40px;left:0;width:300px">Goals heading text block stacked on top</div>',
    '</body></html>',
  ].join('');
  const { dir, file } = tmpHtml(overlap);
  try {
    const source = '# Doc\n\n## Problem\n\np\n\n## Goals\n\np\n';
    const result = runOutputQuality({ exportPath: file, format: 'html', sourceMarkdown: source, baseDir: dir, gateLevel: 'standard' });

    assert.equal(
      result.ok,
      false,
      'a deliverable with two text blocks overlapping at the identical absolute position passed the quality gate',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
