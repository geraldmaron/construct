/**
 * tests/asset-quality/render-pipeline.test.mjs — Guards the render pipeline contract.
 *
 * Detection and degradation need no tools and run deterministically: a missing renderer yields a
 * typed degradation reason from the shared enum, never a silent pass, and an unsupported format is
 * named as such. A real render is smoke-tested only when its tools resolve on PATH, so the suite
 * stays green on a toolless machine while still exercising the live path where tools exist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RENDERERS,
  RENDERABLE_FORMATS,
  detectRenderer,
  renderToImages,
} from '../../lib/render-pipeline.mjs';
import { DEGRADATION_REASONS } from '../../lib/artifact-completion.mjs';

const NO_TOOLING_ENV = { PATH: '/nonexistent-bin-dir' };

test('the registry covers the declared renderable formats', () => {
  assert.deepEqual([...RENDERABLE_FORMATS].sort(), ['d2', 'html', 'mermaid', 'pdf', 'pptx']);
  for (const spec of Object.values(RENDERERS)) {
    assert.ok(Array.isArray(spec.tools) && spec.tools.length > 0);
  }
});

test('detectRenderer reports missing tools as unavailable, not unsupported', () => {
  const detection = detectRenderer('pdf', NO_TOOLING_ENV);
  assert.equal(detection.available, false);
  assert.equal(detection.unsupported, false);
  assert.ok(detection.missing.includes('pdftoppm'));
});

test('detectRenderer marks an unknown format as unsupported', () => {
  const detection = detectRenderer('not-a-format', NO_TOOLING_ENV);
  assert.equal(detection.unsupported, true);
  assert.equal(detection.available, false);
});

test('renderToImages returns a typed degradation, never a silent ok, when it cannot render', () => {
  const missing = renderToImages({ format: 'pdf', inputPath: '/tmp/x.pdf', outDir: '/tmp/o', env: NO_TOOLING_ENV });
  assert.equal(missing.ok, false);
  assert.equal(missing.degradation, 'missing-dependency');

  const unsupported = renderToImages({ format: 'xyz', inputPath: '/tmp/x', outDir: '/tmp/o', env: NO_TOOLING_ENV });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.degradation, 'unsupported-format');

  for (const result of [missing, unsupported]) {
    assert.ok(DEGRADATION_REASONS.includes(result.degradation), `${result.degradation} not in the typed enum`);
    assert.deepEqual(result.images, []);
  }
});

test('renderToD2 produces an image when d2 is installed (skipped otherwise)', () => {
  const available = detectRenderer('d2').available;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-d2-'));
  try {
    const input = path.join(tmp, 'diagram.d2');
    fs.writeFileSync(input, 'a -> b\n');
    const result = renderToImages({ format: 'd2', inputPath: input, outDir: path.join(tmp, 'out') });
    if (!available) {
      assert.equal(result.ok, false);
      assert.equal(result.degradation, 'missing-dependency');
      return;
    }
    assert.equal(result.ok, true, result.message);
    assert.ok(result.images.length >= 1);
    assert.ok(fs.existsSync(result.images[0]));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
