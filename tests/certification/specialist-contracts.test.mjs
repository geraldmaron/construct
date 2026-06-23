/**
 * tests/certification/specialist-contracts.test.mjs — deterministic specialist contract gates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditSpecialistContracts, checkSpecialistContract } from '../../lib/certification/specialist-contracts.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('auditSpecialistContracts passes for the curated registry', () => {
  const result = auditSpecialistContracts({ rootDir: REPO });
  assert.equal(result.pass, true);
  assert.equal(result.count, 29);
});

test('intentional regression fails when anti-fabrication section removed', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'specialists', 'registry.json'), 'utf8'));
  const agent = registry.specialists.find((s) => s.name === 'engineer');
  const promptPath = path.join(REPO, agent.promptFile);
  const original = fs.readFileSync(promptPath, 'utf8');
  const tampered = original.replace('## Anti-fabrication contract', '## Removed section');
  const result = checkSpecialistContract(agent, { rootDir: REPO });
  assert.equal(result.pass, true);
  fs.writeFileSync(promptPath, tampered);
  try {
    const bad = checkSpecialistContract(agent, { rootDir: REPO });
    assert.equal(bad.pass, false);
    assert.ok(bad.checks.some((c) => c.id === 'anti-fabrication-section' && !c.pass));
  } finally {
    fs.writeFileSync(promptPath, original);
  }
});
