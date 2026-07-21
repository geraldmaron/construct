/**
 * tests/certification/extraction-ladder-certification.test.mjs — extraction ladder certification (construct-tsyfe.2.11).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateExtractionLadderCertification } from '../../lib/certification/extraction-ladder-certification.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

async function depsPresent() {
  try {
    await import('unpdf');
    return true;
  } catch {
    try {
      await import('mammoth');
      return true;
    } catch {
      return false;
    }
  }
}

test('validateExtractionLadderCertification routes corpus fixtures and writes evidence artifact', async (t) => {
  if (!(await depsPresent())) {
    t.skip('unpdf/mammoth not installed');
    return;
  }

  const result = await validateExtractionLadderCertification({ rootDir: repoRoot });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.fixtures.length >= 7);
  assert.ok(result.evidencePath);

  const evidenceAbs = path.join(repoRoot, result.evidencePath);
  assert.ok(fs.existsSync(evidenceAbs));
  const evidence = JSON.parse(fs.readFileSync(evidenceAbs, 'utf8'));
  assert.equal(evidence.schema, 'construct/certification/extraction-ladder/1');
  assert.equal(evidence.pass, true);
  assert.ok(Array.isArray(evidence.emailFixtures));
  assert.ok(evidence.emailFixtures.length >= 4);
});
