/**
 * coverage.red.mjs — F11 (durable source vs generated local state).
 *
 * Asserts every file Construct creates in a host project carries an EXPLICIT
 * disposition entry. The rule: "No artifact has an implicit
 * disposition"), but the only machine-readable disposition surface today is
 * `lib/host-disposition.mjs` (`IGNORED_PATTERNS` + `ADAPTER_DIRS`), which
 * enumerates only the ignored subset — and not even all of that.
 *
 * Proof of a created-but-undispositioned file: `scripts/sync-worker-profiles.mjs`
 * (syncCopilot) writes VS Code custom-agent files to
 * `.github/agents/<name>.agent.md`. That path is created by Construct yet has no
 * disposition entry: it is not in IGNORED_PATTERNS (only `.github/prompts/` and
 * `.github/copilot-instructions.md` are), it is not an ADAPTER_DIR, and no entry
 * records its owner, commit recommendation, merge policy, or uninstall/repair
 * handling. A consumer cannot determine whether `.github/agents/` is committed
 * source, ignored cache, or user-managed.
 *
 * The disposition surface is asserted to recognize each created path. Fails
 * today because `.github/agents/` is created but unclassified; passes once the
 * taxonomy enumerates every created file with an explicit disposition.
 *
 * RED today. node --test tests/audit/f11-disposition/coverage.red.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IGNORED_PATTERNS,
  ADAPTER_DIRS,
  MANAGED_PATTERNS,
} from '../../../lib/host-disposition.mjs';

// Paths Construct creates in a host project, traced to their generators. Not
// exhaustive — a representative set spanning each generator family. Each must
// resolve to exactly one disposition the taxonomy can name.

const CREATED_PATHS = [
  // scripts/sync-worker-profiles.mjs syncCopilot — VS Code custom agents.
  { path: '.github/agents/', generator: 'scripts/sync-worker-profiles.mjs:syncCopilot (agentsDir)' },
  // scripts/sync-worker-profiles.mjs syncCopilot — Copilot prompt profiles.
  { path: '.github/prompts/', generator: 'scripts/sync-worker-profiles.mjs:syncCopilot (promptsDir)' },
  // scripts/sync-worker-profiles.mjs syncCopilot — Copilot repo instructions.
  { path: '.github/copilot-instructions.md', generator: 'scripts/sync-worker-profiles.mjs:syncCopilot (instructionsPath)' },
  // lib/init-unified.mjs writeStampedIfMissing — working plan.
  { path: 'plan.md', generator: 'lib/init-unified.mjs (writeStampedIfMissing)' },
];

// The disposition surface is exhausted by IGNORED_PATTERNS and ADAPTER_DIRS
// today; a path is "known" only if one of those names it. A real taxonomy would
// also enumerate committed-source and user-managed dispositions — until it does,
// any created path outside the ignored subset is undispositioned.

function hasExplicitDisposition(createdPath) {
  const bare = createdPath.replace(/\/$/, '');
  if (IGNORED_PATTERNS.includes(createdPath)) return true;
  if (IGNORED_PATTERNS.includes(`${bare}/`)) return true;
  if (MANAGED_PATTERNS.includes(createdPath)) return true;
  if (MANAGED_PATTERNS.includes(`${bare}/`)) return true;
  if (ADAPTER_DIRS.includes(bare)) return true;
  if (ADAPTER_DIRS.includes(`.${bare.replace(/^\./, '')}`)) return false;
  return false;
}

test('every file Construct creates has an explicit disposition entry', () => {
  const undispositioned = CREATED_PATHS.filter((c) => !hasExplicitDisposition(c.path));
  assert.deepEqual(
    undispositioned.map((c) => `${c.path} (${c.generator})`),
    [],
    'created paths with no explicit disposition entry (owner/commit/merge/uninstall) in lib/host-disposition.mjs.',
  );
});

// Narrow the proof to the canonical example so the failure is unambiguous even
// if other paths gain coverage first.

test('.github/agents custom-agent files have an explicit disposition', () => {
  assert.ok(
    hasExplicitDisposition('.github/agents/'),
    '.github/agents/ is created by sync-worker-profiles.mjs (VS Code custom agents) but carries no disposition entry.',
  );
});
