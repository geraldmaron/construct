/**
 * mis-disposition.red.mjs — F11 (durable source vs generated local state).
 *
 * Asserts that a file a host consumes as durable REPOSITORY INSTRUCTIONS is not
 * also classified as disposable, gitignored, sync-regenerated cache.
 *
 * Target file: `.github/copilot-instructions.md`. GitHub Copilot loads it
 * automatically as repository context when present (so it functions as durable
 * repo instructions), and `scripts/sync-worker-profiles.mjs` (syncCopilot, the
 * `replaceManagedBlock` write) treats it as a USER-MANAGED file — only a fenced
 * managed block is rewritten, all user content is preserved. ADR-0027 §2 lists
 * `.github/*` among files "Construct does not own", mutated only via marker
 * blocks (the user-owned managed-block disposition).
 *
 * Yet `lib/host-disposition.mjs` lists `.github/copilot-instructions.md` in
 * `IGNORED_PATTERNS`, and `missingIgnorePatterns()` therefore emits it for the
 * init `.gitignore` writer and the `gitignore-coverage` repair to append. A
 * single file cannot be both a user-owned managed-block source AND ignored
 * cache. This fixture fails today because the file is in IGNORED_PATTERNS; it
 * passes once copilot-instructions.md is reclassified as a managed/user-owned
 * source and removed from the ignore set.
 *
 * RED today. node --test tests/audit/f11-disposition/mis-disposition.red.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IGNORED_PATTERNS,
  missingIgnorePatterns,
} from '../../../lib/host-disposition.mjs';

const HOST_CONSUMED_INSTRUCTION_FILES = ['.github/copilot-instructions.md'];

// A host-consumed instruction file must not appear in the ignored set: Copilot
// reads it as durable repo context and sync rewrites only a managed block in it.

test('host-consumed instruction files are not classified as ignored cache', () => {
  for (const file of HOST_CONSUMED_INSTRUCTION_FILES) {
    assert.ok(
      !IGNORED_PATTERNS.includes(file),
      `${file} is consumed by a host as repository instructions but is listed in IGNORED_PATTERNS (cache disposition).`,
    );
  }
});

// The same contradiction surfaced through the consumer: an empty host
// .gitignore must not be told to ignore a durable instruction file.

test('gitignore writer does not emit host-consumed instruction files as ignores', () => {
  const emitted = missingIgnorePatterns('');
  for (const file of HOST_CONSUMED_INSTRUCTION_FILES) {
    assert.ok(
      !emitted.includes(file),
      `missingIgnorePatterns('') emits ${file}; the init/repair .gitignore writer would gitignore a durable Copilot instruction file.`,
    );
  }
});
