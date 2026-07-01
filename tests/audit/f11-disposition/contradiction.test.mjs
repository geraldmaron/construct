/**
 * contradiction.red.mjs — F11 (durable source vs generated local state).
 *
 * Asserts the install/sync surface does not give a single file two contradictory
 * dispositions: (a) generate it as managed durable Copilot repository context,
 * while (b) gitignoring/treating it as disposable cache.
 *
 * Two real consumers read the SAME `IGNORED_PATTERNS` entry,
 * `.github/copilot-instructions.md`:
 *   - `lib/init-unified.mjs` and `lib/reconcile/gitignore-coverage.mjs` call
 *     `missingIgnorePatterns()` and append every result to the host `.gitignore`
 *     (cache disposition: "never source").
 *   - `scripts/sync-specialists.mjs` (syncCopilot) writes the same file via
 *     `replaceManagedBlock(...)`, preserving user content and rewriting only a
 *     fenced managed block (user-owned managed-block disposition). The source
 *     comment on that write reads "User-managed file with the managed block
 *     carved out — never doc-stamp."
 *
 * Pins the contradiction from both ends without mutating host state: the sync
 * module's source declares the file user-managed, while the disposition module
 * marks the same path as ignored cache. Fails today because both are
 * simultaneously true; passes once the file carries one disposition
 * (managed/user-owned source, removed from IGNORED_PATTERNS).
 *
 * RED today. node --test tests/audit/f11-disposition/contradiction.red.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IGNORED_PATTERNS,
  missingIgnorePatterns,
} from '../../../lib/host-disposition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const COPILOT_INSTRUCTIONS = '.github/copilot-instructions.md';

function readSource(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

// Establish (a): the sync writer treats copilot-instructions.md as a
// user-managed, marker-block file — never a regenerable cache artifact.

test('sync writes copilot-instructions.md as a user-managed managed-block file', () => {
  const syncSrc = readSource('scripts/sync-specialists.mjs');
  assert.match(
    syncSrc,
    /copilot-instructions\.md/,
    'sync-specialists.mjs no longer references copilot-instructions.md — re-derive the contradiction source.',
  );
  assert.match(
    syncSrc,
    /replaceManagedBlock\([^)]*instructionsPath|instructionsPath[\s\S]*replaceManagedBlock/,
    'expected syncCopilot to write copilot-instructions.md via replaceManagedBlock (managed-block disposition).',
  );
});

// Establish (b): the same path is simultaneously declared ignored cache, and
// the .gitignore writers (init + gitignore-coverage) emit it as such. With both
// (a) and (b) true, the guidance is contradictory.

test('copilot-instructions.md is not simultaneously declared ignored cache', () => {
  const initSrc = readSource('lib/init-unified.mjs');
  const repairSrc = readSource('lib/reconcile/gitignore-coverage.mjs');

  assert.match(
    initSrc,
    /missingIgnorePatterns\(/,
    'init-unified.mjs no longer feeds missingIgnorePatterns into the .gitignore writer — re-derive the contradiction.',
  );
  assert.match(
    repairSrc,
    /missingIgnorePatterns\(/,
    'gitignore-coverage.mjs no longer feeds missingIgnorePatterns into the .gitignore writer — re-derive the contradiction.',
  );

  const wouldBeGitignored = missingIgnorePatterns('').includes(COPILOT_INSTRUCTIONS);
  const inIgnoreSet = IGNORED_PATTERNS.includes(COPILOT_INSTRUCTIONS);

  assert.ok(
    !(inIgnoreSet && wouldBeGitignored),
    `${COPILOT_INSTRUCTIONS} is written by sync as a user-managed instruction file AND gitignored as cache by init/gitignore-coverage — one file, two contradictory dispositions.`,
  );
});
