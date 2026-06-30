/**
 * tests/audit/f13-artifact/missing-local-reference.red.mjs — F13 [R21] unvalidated-reference proof.
 *
 * RED fixtures (must FAIL against current code). referenceIntegrity (lib/export-validate.mjs L91-106)
 * resolves local targets only from inline markdown image/link SYNTAX in the SOURCE — `![](x)` and
 * `[](x)`. Two real reference channels escape it entirely:
 *   1. The PRODUCED deliverable's own internal references. runOutputQuality scans `sourceMarkdown`,
 *      never the exported file, so an exported HTML whose `<img src="./gone.png">` points at a missing
 *      local asset passes with `ok: true` — a broken image in the artifact a user is about to claim.
 *   2. Non-`![]()` reference forms in the source: raw inline `<img src>` HTML and reference-style
 *      definitions (`![x][c]` + `[c]: ./gone.png`) are never matched, so their missing targets are
 *      invisible to the gate.
 *
 * Contract (CX-AUDIT-ARTIFACT-002/-004): a deliverable that references a missing local asset must
 * fail the quality gate when claims are made, and the evidence manifest must bind to the produced
 * output, not just the source markdown. Each test asserts a missing local reference makes the result
 * NOT ok. Today every case passes — proving the gaps. They flip green once reference integrity covers
 * the produced file and the non-`![]()` reference forms.
 *
 * Hermetic: tmpdir export + empty PATH; the reference probe is fs-only, so it is deterministic on any
 * host. No host state is touched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runOutputQuality } from '../../../lib/output-quality.mjs';

const NO_TOOLS = { PATH: '/nonexistent-bin-dir-f13' };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'f13-mlr-'));
}

test('[R21] exported HTML deliverable with an internal <img src> to a missing local asset must FAIL', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'deliverable.html');
    fs.writeFileSync(file, '<html><body><h1>Doc</h1><h2>Problem</h2><img src="./gone.png"></body></html>');
    const source = '# Doc\n\n## Problem\n\nbody\n';
    const result = runOutputQuality({ exportPath: file, format: 'html', sourceMarkdown: source, baseDir: dir, gateLevel: 'standard', env: NO_TOOLS });

    assert.equal(
      result.ok,
      false,
      'a produced deliverable that itself references a missing local image passed the quality gate',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[R21] source inline-HTML <img src> to a missing local asset must FAIL the reference gate', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'deliverable.html');
    fs.writeFileSync(file, '<html><body><h1>Doc</h1><h2>Problem</h2><p>body</p></body></html>');
    const source = '# Doc\n\n## Problem\n\n<img src="./missing-inline.png">\n\nbody\n';
    const result = runOutputQuality({ exportPath: file, format: 'html', sourceMarkdown: source, baseDir: dir, gateLevel: 'standard', env: NO_TOOLS });

    assert.equal(
      result.ok,
      false,
      'a source raw-HTML <img src> pointing at a missing local asset passed the quality gate',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[R21] reference-style markdown image definition to a missing local asset must FAIL the reference gate', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'deliverable.html');
    fs.writeFileSync(file, '<html><body><h1>Doc</h1><h2>Problem</h2><p>body</p></body></html>');
    const source = '# Doc\n\n## Problem\n\n![chart][c]\n\nbody\n\n[c]: ./missing-refdef.png\n';
    const result = runOutputQuality({ exportPath: file, format: 'html', sourceMarkdown: source, baseDir: dir, gateLevel: 'standard', env: NO_TOOLS });

    assert.equal(
      result.ok,
      false,
      'a reference-style image definition pointing at a missing local asset passed the quality gate',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
