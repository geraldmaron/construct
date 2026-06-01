/**
 * cli-catalog-parity.functional.test.mjs — every handler in bin/construct
 * must have a CLI_COMMANDS entry, and every CLI_COMMANDS entry must have a
 * handler. The original defect: 28 handlers existed in the dispatch map
 * but were never advertised — invisible in help, in completions, in the
 * dashboard — so users couldn't discover them and contributors couldn't
 * tell which ones were intentional vs forgotten.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CLI_COMMANDS, ALL_COMMAND_NAMES } from '../../lib/cli-commands.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

// Parse the handlers Map declaration in bin/construct. The shape is
// stable: `const handlers = new Map([` opener followed by `['<name>', fn]`
// or `['<name>', async (args) => { ... }]` rows. Closer is `]);` at column
// zero. Brittle by design — any change to the handler table format will
// fail loudly and force re-validation.

function readHandlerNames() {
  const source = fs.readFileSync(BIN, 'utf8');
  const start = source.indexOf('const handlers = new Map([');
  assert.ok(start >= 0, 'handlers map opener not found in bin/construct');
  const after = source.slice(start);
  const closerMatch = after.match(/\n\]\);/);
  assert.ok(closerMatch, 'handlers map closer (newline + "]);")  not found');
  const body = after.slice(0, closerMatch.index);
  const names = new Set();
  // Match rows that start a line at the top-level row indent (2 or 3
  // spaces — a few rows have stray leading whitespace). Anchoring on
  // newline + small indent + `[` filters out nested arrays inside
  // arrow-function bodies, which sit at deeper indents.
  for (const m of body.matchAll(/\n {2,3}\[\s*'([^']+)'\s*,/g)) {
    names.add(m[1]);
  }
  return names;
}

test('every handler in bin/construct is declared in CLI_COMMANDS', () => {
  const handlerNames = readHandlerNames();
  const catalogNames = new Set(ALL_COMMAND_NAMES);
  const orphans = [...handlerNames].filter((n) => !catalogNames.has(n));
  assert.deepEqual(
    orphans,
    [],
    `Handler(s) in bin/construct have no CLI_COMMANDS entry: ${orphans.join(', ')}.
Add an entry (with internal:true if it's not user-facing) to lib/cli-commands.mjs.`,
  );
});

test('every CLI_COMMANDS entry has a handler in bin/construct', () => {
  const handlerNames = readHandlerNames();
  const catalogOnly = ALL_COMMAND_NAMES.filter((n) => !handlerNames.has(n));
  assert.deepEqual(
    catalogOnly,
    [],
    `CLI_COMMANDS entries with no handler in bin/construct: ${catalogOnly.join(', ')}.
Either add a handler or remove the catalog entry.`,
  );
});

test('every CLI_COMMANDS entry has a description and usage string', () => {
  const missing = [];
  for (const spec of CLI_COMMANDS) {
    if (!spec.description) missing.push(`${spec.name} (description)`);
    if (!spec.usage) missing.push(`${spec.name} (usage)`);
  }
  assert.deepEqual(missing, [], `CLI_COMMANDS entries missing required fields: ${missing.join(', ')}`);
});
