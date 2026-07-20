/**
 * tests/certification/rc-gate.test.mjs — release candidate certification gate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evidenceSatisfiesCertification, runReleaseCandidateGate } from '../../lib/certification/rc-gate.mjs';
import { applyStaleImpact } from '../../lib/certification/stale-impact.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('runReleaseCandidateGate passes on clean repo', async () => {
  const result = await runReleaseCandidateGate({ rootDir: REPO });
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.releaseCapabilityCount >= 8);
});

test('runReleaseCandidateGate fails when a release capability is stale', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-rc-stale-'));
  fs.mkdirSync(path.join(root, '.construct', 'certification'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'capabilities'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'certification', 'scenarios'), { recursive: true });
  for (const rel of [
    'tests/capabilities/ledger.json',
    'tests/certification/scenarios/catalog.json',
    'package.json',
  ]) {
    fs.copyFileSync(path.join(REPO, rel), path.join(root, rel));
  }
  fs.cpSync(
    path.join(REPO, 'tests', 'certification', 'scenarios', 'oracle'),
    path.join(root, 'tests', 'certification', 'scenarios', 'oracle'),
    { recursive: true },
  );
  applyStaleImpact({ rootDir: root, changedFiles: ['lib/artifact-release-gate.mjs'] });
  const result = await runReleaseCandidateGate({ rootDir: root, runHermetic: false });
  assert.equal(result.pass, false);
  assert.ok(result.errors.some((err) => err.includes('stale capability artifact.release-gate')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('skipped live runs do not satisfy certification evidence', () => {
  assert.equal(evidenceSatisfiesCertification({
    verdict: { status: 'inconclusive', source: 'skipped-provider' },
  }), false);
  assert.equal(evidenceSatisfiesCertification({
    verdict: { status: 'pass', source: 'skipped-provider' },
  }), false);
  assert.equal(evidenceSatisfiesCertification({
    verdict: { status: 'pass', source: 'deterministic' },
  }), true);
});
