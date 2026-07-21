/**
 * Deterministic Worker Profile prompt contract gates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditWorkerProfileContracts, checkWorkerProfileContract } from '../../lib/certification/worker-profile-contracts.mjs';
import { loadRegistry } from '../../lib/registry/loader.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('auditWorkerProfileContracts passes for the curated registry', () => {
  const result = auditWorkerProfileContracts({ rootDir: REPO });
  assert.equal(result.pass, true);
  assert.equal(result.count, 12);
});

test('intentional regression fails when anti-fabrication section removed', () => {
  const registry = loadRegistry({ rootDir: REPO });
  const profile = registry.workerProfiles.engineer;
  const promptPath = path.join(REPO, 'registry', 'worker-profiles', 'prompts', 'engineer.md');
  const original = fs.readFileSync(promptPath, 'utf8');
  const tampered = original.replace('## Anti-fabrication contract', '## Removed section');
  const result = checkWorkerProfileContract(profile, { rootDir: REPO });
  assert.equal(result.pass, true);
  fs.writeFileSync(promptPath, tampered);
  try {
    const bad = checkWorkerProfileContract(profile, { rootDir: REPO });
    assert.equal(bad.pass, false);
    assert.ok(bad.checks.some((c) => c.id === 'anti-fabrication-section' && !c.pass));
  } finally {
    fs.writeFileSync(promptPath, original);
  }
});
