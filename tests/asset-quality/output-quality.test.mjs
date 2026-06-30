/**
 * tests/asset-quality/output-quality.test.mjs — Guards the post-export output-quality pass.
 *
 * runOutputQuality is the production consumer that wires export-validate, brand-contrast, and
 * render-evidence into publish. The HTML path needs no external tooling and is exercised fully;
 * the contract asserts that a typed degradation never fails the pass and that a real dropped
 * heading does. render capture only fires at render-smoke and higher levels.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOutputQuality } from '../../lib/output-quality.mjs';

function tmpHtml(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-'));
  const file = path.join(dir, 'out.html');
  fs.writeFileSync(file, body);
  return { dir, file };
}

test('output quality passes a faithful HTML export and asserts the brand palette', () => {
  const { dir, file } = tmpHtml('<html><body><h1>Doc</h1><h2>Problem</h2><h2>Goals</h2><p>body</p></body></html>');
  try {
    const source = '# Doc\n\n## Problem\n\np\n\n## Goals\n\np\n';
    const result = runOutputQuality({ exportPath: file, format: 'html', sourceMarkdown: source, baseDir: dir, gateLevel: 'standard' });
    assert.equal(result.ok, true, JSON.stringify(result.failures));
    assert.equal(result.checks.roundtrip.ok, true);
    assert.equal(result.contrast.ok, true);
    assert.equal(result.render, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('output quality fails when the export drops a source heading', () => {
  const { dir, file } = tmpHtml('<html><body><h1>Doc</h1><h2>Problem</h2><p>body</p></body></html>');
  try {
    const source = '# Doc\n\n## Problem\n\np\n\n## Appendix\n\np\n';
    const result = runOutputQuality({ exportPath: file, format: 'html', sourceMarkdown: source, baseDir: dir, gateLevel: 'standard' });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => /roundtrip/.test(f)), JSON.stringify(result.failures));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing-tool degradation never fails the pass', () => {
  const { dir, file } = tmpHtml('<html><body><h1>Doc</h1></body></html>');
  try {
    const result = runOutputQuality({
      exportPath: file,
      format: 'pdf',
      sourceMarkdown: '# Doc\n',
      baseDir: dir,
      gateLevel: 'standard',
      env: { PATH: '/nonexistent-bin-dir' },
    });
    assert.equal(result.ok, true, JSON.stringify(result.failures));
    assert.equal(result.checks.pdf.degradation, 'missing-dependency');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
