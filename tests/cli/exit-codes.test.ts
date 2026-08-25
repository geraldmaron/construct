/**
 * tests/cli/exit-codes.test.ts — the exit-code contract documented in
 * docs/exit-codes.md is the whole contract, kept honest against the source it
 * describes rather than trusted to stay in sync with it by hand.
 *
 * Every verb in src/cli/ returns 0 (succeeded), 1 (operation failed), or 2
 * (usage error) — nothing else. This scans every `return <number>;` and
 * `process.exit(<number>)` in src/cli/ and fails if a value outside that set
 * ever appears, so a new verb reaching for a fourth code breaks the build
 * rather than quietly drifting the documented table.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CLI_DIR = join(import.meta.dirname, '..', '..', 'src', 'cli');
const DOC = join(import.meta.dirname, '..', '..', 'docs', 'exit-codes.md');
const DOCUMENTED_CODES = new Set([0, 1, 2]);

function cliFiles(): string[] {
  return readdirSync(CLI_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(CLI_DIR, f));
}

test('every numeric exit path in src/cli/ is one of the documented codes', () => {
  const offenders: string[] = [];
  for (const file of cliFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\breturn\s+(-?\d+)\s*;/g)) {
      const code = Number(match[1]);
      if (!DOCUMENTED_CODES.has(code)) offenders.push(`${file}: return ${String(code)}`);
    }
    for (const match of text.matchAll(/process\.exit\((-?\d+)\)/g)) {
      const code = Number(match[1]);
      if (!DOCUMENTED_CODES.has(code)) offenders.push(`${file}: process.exit(${String(code)})`);
    }
  }
  assert.deepEqual(offenders, [], 'a code outside {0, 1, 2} needs docs/exit-codes.md updated first');
});

test('docs/exit-codes.md documents all three codes', () => {
  const doc = readFileSync(DOC, 'utf8');
  for (const code of DOCUMENTED_CODES) {
    assert.match(doc, new RegExp('`' + String(code) + '`'), `docs/exit-codes.md must name code ${String(code)}`);
  }
});
