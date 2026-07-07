/**
 * tests/asset-quality/render-evidence.test.mjs — Render evidence ties rendering to the ledger.
 *
 * A successful render yields screenshot-captured evidence with a digest and image proof that
 * advances the completion ladder; a degraded render yields evidence carrying the typed degradation
 * reason that is recorded but never lifts the state. The d2 path runs live where d2 exists and
 * falls back to asserting the degradation contract otherwise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureRenderEvidence, renderEvidenceDir } from '../../lib/render-evidence.mjs';
import { recordCompletion, highestState } from '../../lib/artifact-completion.mjs';
import { detectRenderer } from '../../lib/render-pipeline.mjs';

const NO_TOOLING_ENV = { PATH: '/nonexistent-bin-dir' };

test('renderEvidenceDir places images under a stable .cx/render path', () => {
  const dir = renderEvidenceDir('/repo', 'prd.pdf');
  assert.equal(dir, path.join('/repo', '.construct', 'render', 'prd.pdf'));
});

test('a degraded render records evidence that never lifts the ladder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-ev-'));
  try {
    const { result, evidence } = captureRenderEvidence({
      format: 'pdf',
      inputPath: '/tmp/missing.pdf',
      outDir: path.join(tmp, 'out'),
      env: NO_TOOLING_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal(evidence.state, 'screenshot-captured');
    assert.equal(evidence.degradation, 'missing-dependency');

    const ledger = recordCompletion([], evidence);
    assert.equal(highestState(ledger), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a successful d2 render advances to screenshot-captured with a digest (skipped without d2)', () => {
  const available = detectRenderer('d2').available;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-ev-d2-'));
  try {
    const input = path.join(tmp, 'diagram.d2');
    fs.writeFileSync(input, 'a -> b\n');
    const { result, evidence } = captureRenderEvidence({ format: 'd2', inputPath: input, outDir: path.join(tmp, 'out') });
    if (!available) {
      assert.equal(result.ok, false);
      assert.equal(evidence.degradation, 'missing-dependency');
      return;
    }
    assert.equal(result.ok, true, result.message);
    assert.equal(evidence.degradation, null);
    assert.match(evidence.digest, /^sha256:/);
    assert.ok(evidence.proof.count >= 1);
    assert.equal(highestState(recordCompletion([], evidence)), 'screenshot-captured');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
