/**
 * tests/certification/export-format-cert.test.mjs — deck/pptx/doc/pdf export certification.
 *
 * @capability publish.deck-export
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportMarkdown } from '../../lib/document-export.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-deck-platform.md');

function tmpOut(ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-export-'));
  return { dir, path: path.join(dir, `out.${ext}`) };
}

test('deck export produces non-empty branded html or actionable degradation', () => {
  const { dir, path: out } = tmpOut('html');
  try {
    const result = exportMarkdown({
      inputPath: FIXTURE,
      outputPath: out,
      format: 'deck',
      repoRoot: REPO,
    });
    if (result.ok) {
      assert.ok(fs.existsSync(out));
      assert.ok(fs.statSync(out).size > 0);
      const html = fs.readFileSync(out, 'utf8');
      assert.match(html, /Construct|Jakarta|deck/i);
    } else {
      assert.ok(result.hint || result.reason, 'missing engine should return actionable hint');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pptx export produces file or actionable hint when engine missing', () => {
  const { dir, path: out } = tmpOut('pptx');
  try {
    const result = exportMarkdown({
      inputPath: FIXTURE,
      outputPath: out,
      format: 'pptx',
      repoRoot: REPO,
    });
    if (result.ok) {
      assert.ok(fs.statSync(out).size > 0);
    } else {
      assert.ok(result.hint || result.reason);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
