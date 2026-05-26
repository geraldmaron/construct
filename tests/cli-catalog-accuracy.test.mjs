/**
 * tests/cli-catalog-accuracy.test.mjs — CLI catalog vs handler-map parity.
 *
 * Audit guard: every command listed in lib/cli-commands.mjs must have a
 * matching handler entry in bin/construct, and every handler in bin/construct
 * must appear in the public catalog. Drift between the two has been a
 * recurring source of "command in help, no handler" and "handler exists, no
 * help" bugs.
 *
 * Also asserts that the catalog table has the required fields (description,
 * usage) so AUTO-generated README sections never render with empty cells.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { CLI_COMMANDS as COMMANDS } from '../lib/cli-commands.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = fs.readFileSync(path.join(REPO, 'bin', 'construct'), 'utf8');

// Handlers that exist intentionally without a catalog entry: aliases for
// legacy invocations, namespaced utility subcommands, dev-only helpers. Add
// here with a one-line justification rather than expanding the catalog when
// something is not meant to be user-discoverable.
const HANDLER_ONLY_ALLOWLIST = new Set([
  'help',                  // built-in help
  'up', 'down',            // legacy aliases for dev/stop
  'prune',                 // sub-tool for cleanup paths
  'resources', 'costs',    // sub-namespaces under config/observability
  'handoffs',              // namespace under role framework
  'docs:verify', 'docs:update', 'docs:check', 'docs:site',   // operational doc gates
  'init:update',           // partial-update path for upgrade flows
  'beads:stats',           // internal beads telemetry
  'policy:list',           // operational policy-engine inspector
  'seed-traces',           // dev-only trace generator
  'dashboard:sync',        // operational sync gate
  'lint:comments', 'lint:templates', 'lint:research', 'lint:agents', 'lint:contracts', // gates
  'hook', 'doc',           // single-arg utility dispatchers
  'roles:list', 'roles:set',                              // role framework admin
  'feedback:record', 'feedback:history',                  // intake feedback admin
  'evaluator:rubrics',     // dev-only rubric inspector
  'activation:status',     // dev-only activation inspector
  'telemetry-backfill', 'telemetry-setup',                // operational setup gates
  'eval-datasets',         // dev-only eval dataset listing
  'ask',                   // RAG ask path; surfaced via knowledge in the catalog
  'pricing', 'overrides',  // cost subcommand sub-tools
]);

function extractHandlerNames() {
  const names = new Set();
  // Match every `['<name>', ...]` entry in the handlers map.
  const re = /\[\s*['"]([a-z][a-z0-9:-]*)['"]\s*,\s*[A-Za-z(]/g;
  let m;
  while ((m = re.exec(BIN)) !== null) names.add(m[1]);
  return names;
}

test('every catalog entry has a handler in bin/construct', () => {
  const handlers = extractHandlerNames();
  const missing = COMMANDS.filter((c) => !handlers.has(c.name)).map((c) => c.name);
  assert.deepEqual(missing, [], `catalog entries missing a handler: ${missing.join(', ')}`);
});

test('every catalog entry has description + usage fields', () => {
  for (const cmd of COMMANDS) {
    assert.ok(cmd.description && cmd.description.length > 0, `${cmd.name} missing description`);
    assert.ok(cmd.usage && cmd.usage.startsWith('construct '), `${cmd.name} usage must start with "construct "`);
  }
});

test('catalog entries have unique names (no double-registration)', () => {
  const seen = new Set();
  const dupes = [];
  for (const cmd of COMMANDS) {
    if (seen.has(cmd.name)) dupes.push(cmd.name);
    seen.add(cmd.name);
  }
  assert.deepEqual(dupes, [], `duplicate catalog names: ${dupes.join(', ')}`);
});

test('catalog and handlers reconcile: no orphan handler outside the allowlist', () => {
  const handlers = extractHandlerNames();
  const catalogNames = new Set(COMMANDS.map((c) => c.name));
  const orphans = [...handlers].filter((h) => !catalogNames.has(h) && !HANDLER_ONLY_ALLOWLIST.has(h));
  assert.deepEqual(orphans, [], `handlers without a catalog entry (add to catalog or to HANDLER_ONLY_ALLOWLIST): ${orphans.join(', ')}`);
});
