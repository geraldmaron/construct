/**
 * Canonical registry CLI contract: one public noun per registry concept and
 * no command aliases for retired organization/configuration concepts.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { COMMAND_NAMES } from '../lib/cli-commands.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'bin', 'construct');
const CANONICAL_NOUNS = ['workspace-preset', 'worker-profile', 'procedure', 'capability', 'policy'];
const RETIRED_NOUNS = ['scope', 'team', 'specialist', 'persona', 'workflow'];

test('command catalog exposes only canonical registry nouns', () => {
  for (const noun of CANONICAL_NOUNS) assert.ok(COMMAND_NAMES.includes(noun), `missing ${noun}`);
  for (const noun of RETIRED_NOUNS) assert.ok(!COMMAND_NAMES.includes(noun), `retired command remains: ${noun}`);
});

test('canonical registry commands list and show records', () => {
  for (const noun of CANONICAL_NOUNS) {
    const listed = execFileSync(process.execPath, [BIN, noun, 'list', '--json'], { cwd: ROOT, encoding: 'utf8' });
    const records = JSON.parse(listed);
    assert.ok(Array.isArray(records) && records.length > 0, `${noun} list should return records`);
    const shown = execFileSync(process.execPath, [BIN, noun, 'show', records[0].id, '--json'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(JSON.parse(shown).id, records[0].id);
  }
});

test('retired registry commands have no dispatch aliases', () => {
  for (const noun of RETIRED_NOUNS) {
    const result = spawnSync(process.execPath, [BIN, noun, 'list'], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0, `${noun} must not dispatch`);
    assert.match(result.stderr, /Unknown command/);
  }
});
