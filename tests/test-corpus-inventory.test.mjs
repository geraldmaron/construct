/**
 * tests/test-corpus-inventory.test.mjs — corpus inventory generator and validator.
 *
 * @capability test-system.corpus-inventory
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildTestCorpusInventory,
  classifyTestFile,
  defaultCorpusInventoryPath,
  validateCorpusInventory,
} from '../lib/test-corpus-inventory.mjs';

test('classifies functional tests by path', () => {
  const entry = classifyTestFile('tests/functional/demo.functional.test.mjs', '/** demo */\n');
  assert.equal(entry.layer, 'functional');
  assert.equal(entry.category, 'functional');
});

test('the committed corpus inventory matches every test file on disk', () => {
  const inventoryPath = defaultCorpusInventoryPath();
  assert.ok(fs.existsSync(inventoryPath), 'run node scripts/generate-test-corpus-inventory.mjs');
  const result = validateCorpusInventory();
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.ok(result.fileCount >= 400);
});

test('inventory summary counts align with file entries', () => {
  const inventory = buildTestCorpusInventory();
  assert.equal(inventory.summary.testFiles, inventory.files.length);
  assert.ok(inventory.releaseCriticalGaps.length >= 0);
  assert.ok(inventory.files.every((entry) => entry.path.startsWith('tests/')));
});

test('inventory file is newer than the generator module', () => {
  const inventoryPath = defaultCorpusInventoryPath();
  const generatorPath = path.join(path.dirname(inventoryPath), '../../lib/test-corpus-inventory.mjs');
  const inventoryMtime = fs.statSync(inventoryPath).mtimeMs;
  const generatorMtime = fs.statSync(generatorPath).mtimeMs;
  assert.ok(inventoryMtime >= generatorMtime - 1000);
});
