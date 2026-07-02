/**
 * dogfood-certification.functional.test.mjs — Construct certifies its own distribution gallery.
 *
 * @capability publish.distribution
 *
 * Drives the real example artifacts in examples/distribution (the same sources `npm run
 * examples:distribution` ships) through the publish output-quality pass and asserts each one
 * certifies end-to-end: it exports, validates the produced file, preserves its source content,
 * and reports an honest per-format a11y coverage. Per item it skips cleanly when that format's
 * toolchain is absent, so the gate degrades rather than failing on a machine without renderers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runPublish } from '../../lib/publish.mjs';
import { detectPublishPipeline } from '../../lib/publish-tooling.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const EXAMPLES_DIR = path.join(REPO, 'examples', 'distribution');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, 'manifest.json'), 'utf8'));

function isMermaidBrowserRuntimeFailure(result) {
  const message = String(result?.message || '');
  return /Failed to launch the browser process|mmdc needs Chrome|PUPPETEER_EXECUTABLE_PATH|install Google Chrome/i.test(message);
}

for (const item of MANIFEST.items) {
  const format = item.formats[0];
  test(`dogfood: ${item.id} certifies via ${format}`, (t) => {
    const detection = detectPublishPipeline({ format, includeFigures: true, cwd: REPO, repoRoot: REPO });
    if (!detection.present) {
      t.skip(`${format} toolchain absent: ${detection.missing?.join(', ')}`);
      return;
    }
    const source = path.join(EXAMPLES_DIR, item.source);
    assert.ok(fs.existsSync(source), `missing example source: ${item.source}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dogfood-${item.id}-`));
    try {
      const out = path.join(dir, `${item.id}.${format === 'deck' ? 'html' : format}`);
      const result = runPublish({
        inputPath: source,
        outputPath: out,
        format,
        gate: false,
        preview: true,
        artifactType: item.artifactType,
        cwd: dir,
        repoRoot: REPO,
      });
      if (!result.ok && isMermaidBrowserRuntimeFailure(result)) {
        t.skip(`render runtime unavailable: ${result.message}`);
        return;
      }
      assert.equal(result.ok, true, result.message);
      assert.ok(fs.existsSync(out), 'export produced no file');

      const validation = result.ledger.validation;
      assert.ok(validation, 'expected an output-quality report');

      const roundtrip = validation.checks.roundtrip;
      assert.ok(roundtrip.ok || roundtrip.degradation, 'content roundtrip must pass or degrade with a typed reason, never silently fail');

      assert.ok(validation.a11y?.coverage, 'report states a11y coverage');
      assert.ok(Array.isArray(validation.a11y.coverage.checked), 'a11y coverage lists checked items');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
