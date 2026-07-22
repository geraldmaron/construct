/**
 * tests/certification/corpus-contract.test.mjs — certification scenario corpus contract.
 *
 * Pins two things: the inventory in lib/certification/corpus-contract.mjs names all five
 * catalog files with a real consumer and a stays-separate/merges decision, and the built
 * catalog (tests/certification/scenarios/catalog.json) carries zero duplicate scenario ids
 * — today and after a synthetic collision is injected directly against the pure detector.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORPUS_CATALOGS,
  findDuplicateScenarioIds,
  validateCorpusContract,
} from '../../lib/certification/corpus-contract.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('corpus inventory names all five catalogs with a real file, consumer, and decision', () => {
  assert.equal(CORPUS_CATALOGS.length, 5, 'exactly five catalogs are inventoried');
  const expectedFiles = [
    'lib/certification/scenarios.mjs',
    'lib/certification/worker-profile-cards.mjs',
    'lib/certification/canonical-scenarios.mjs',
    'lib/certification/real-llm-scenarios.mjs',
    'lib/certification/skill-scenarios.mjs',
  ];
  const files = CORPUS_CATALOGS.map((entry) => entry.file);
  assert.deepEqual([...files].sort(), [...expectedFiles].sort());

  for (const entry of CORPUS_CATALOGS) {
    assert.ok(fs.existsSync(path.join(REPO, entry.file)), `${entry.file} exists on disk`);
    assert.ok(entry.citation.includes(entry.file), `${entry.file} citation references its own path`);
    assert.ok(entry.consumer.length > 0, `${entry.file} names a consumer`);
    assert.equal(entry.decision, 'stays-separate', `${entry.file} decision is stays-separate (no merge justified)`);
  }
});

test('canonical-scenarios.mjs is inventoried as demo-parity scope, not specialist-behavior', () => {
  const entry = CORPUS_CATALOGS.find((c) => c.file === 'lib/certification/canonical-scenarios.mjs');
  assert.ok(entry, 'canonical-scenarios.mjs is inventoried');
  assert.match(entry.scope, /demo-parity/);
  assert.match(entry.consumer, /demo-parity\.mjs/);
});

test('findDuplicateScenarioIds is a pure detector — fails closed on an injected collision', () => {
  const clean = [{ id: 'specialist.representative.architect' }, { id: 'skill.positive.foo' }];
  assert.deepEqual(findDuplicateScenarioIds(clean), []);

  const collided = [...clean, { id: 'skill.positive.foo' }];
  assert.deepEqual(findDuplicateScenarioIds(collided), ['skill.positive.foo']);
});

test('the built catalog has zero duplicate scenario ids today', () => {
  const result = validateCorpusContract({ repoRoot: REPO });
  assert.equal(result.pass, true, `duplicate scenario ids found: ${result.errors.join('; ')}`);
  assert.deepEqual(result.duplicates, []);
  assert.ok(result.scenarioCount > 0, 'the catalog carries at least one scenario');
});
