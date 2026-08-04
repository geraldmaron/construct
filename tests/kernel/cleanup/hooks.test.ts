/**
 * tests/kernel/cleanup/hooks.test.ts — whose hooks cleanup is allowed to remove
 * (construct-7pp).
 *
 * The defect these exist for: the un-merge deleted the entire `hooks` block
 * whenever any hooks were present, then deleted the file because emptying it
 * left nothing behind. Its own description promised it "preserves any user-added
 * keys". Run in the v3 checkout it would have taken this repo's fabrication lint
 * and both `bd prime` hooks — none of them a predecessor trace, and the checkout
 * where cleanup is most likely to be run is the one where it did the most harm.
 *
 * The fixtures are not invented. They are the shapes actually found in the
 * settings.json files still on this machine: two spellings of the predecessor's
 * launcher (`.construct/run.mjs` and `.construct/launcher/run.mjs`), with and
 * without the `${CLAUDE_PROJECT_DIR:-…}` prefix, and — in two projects — a
 * user-authored `node -e` validator sitting in the same block as the
 * predecessor's hooks, which is precisely the case that must survive.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildCleanupCatalog } from '../../../src/kernel/cleanup/catalog.ts';
import type { CleanupItem, SpawnFn } from '../../../src/kernel/cleanup/catalog.ts';
import { resolvePaths } from '../../../src/kernel/paths.ts';

const NOT_FOUND_SPAWN: SpawnFn = () => ({ status: 1, stdout: '', stderr: '' });

/** The predecessor's own hooks, both launcher spellings seen in the wild. */
const LEGACY_HOOK = 'node .construct/run.mjs hook adaptive-lint';
const LEGACY_HOOK_LAUNCHER =
  'node "${CLAUDE_PROJECT_DIR:-/Users/x/Projects/admin-app}/.construct/launcher/run.mjs" hook session-start';

/** This repo's real hooks, verbatim. None of them is a predecessor trace. */
const OWN_HOOKS = {
  PostToolUse: [
    { hooks: [{ command: 'node scripts/hooks/no-fabrication-lint.mjs', type: 'command' }], matcher: 'Write|Edit' },
  ],
  PreCompact: [{ hooks: [{ command: 'bd prime', type: 'command' }], matcher: '' }],
  SessionStart: [{ hooks: [{ command: 'bd prime', type: 'command' }], matcher: '' }],
};

function fixture(settings: unknown): { dir: string; file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-hooks-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const file = path.join(dir, '.claude', 'settings.json');
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { dir, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Run just the project-settings item against a fixture checkout. */
function runSettingsItem(dir: string): { detected: boolean; result: string | null } {
  const home = path.join(dir, 'fake-home');
  const items = buildCleanupCatalog({
    cwd: dir,
    home,
    paths: resolvePaths({ HOME: home }, home),
    spawn: NOT_FOUND_SPAWN,
  });
  const item = items.find((i: CleanupItem) => i.id === 'project-settings');
  assert.ok(item, 'the project settings item should exist in the catalog');
  const detected = item.detect();
  return { detected, result: detected ? item.remove() : null };
}

test('a checkout whose only hooks are its own is not touched at all', () => {
  // The exact file this repo carries. Before construct-7pp it was deleted.
  const f = fixture({ hooks: OWN_HOOKS });
  try {
    const { detected } = runSettingsItem(f.dir);
    assert.equal(detected, false, 'non-predecessor hooks are not a Construct trace');

    assert.ok(fs.existsSync(f.file), 'the file must still exist');
    const after = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    assert.deepEqual(after, { hooks: OWN_HOOKS }, 'and be byte-for-byte the same settings');
  } finally {
    f.cleanup();
  }
});

test('the predecessor\'s hooks go and everything beside them stays', () => {
  // The tributary/oracle-app shape: a user's own validator in the same block.
  const usersOwn = { command: 'node -e "JSON.parse(require(\'fs\').readFileSync(p))"', type: 'command' };
  const f = fixture({
    hooks: {
      PostToolUse: [
        {
          matcher: 'Write',
          hooks: [usersOwn, { command: LEGACY_HOOK, type: 'command' }],
        },
      ],
      SessionStart: [{ matcher: '', hooks: [{ command: LEGACY_HOOK_LAUNCHER, type: 'command' }] }],
    },
    permissions: { allow: ['Bash(npm test)'] },
  });
  try {
    const { detected, result } = runSettingsItem(f.dir);
    assert.equal(detected, true, 'a real predecessor hook is a real trace');
    assert.match(result ?? '', /2 hook\(s\)/);

    const after = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    assert.deepEqual(
      after.hooks.PostToolUse[0].hooks,
      [usersOwn],
      "the user's own hook survives in place",
    );
    assert.equal(
      'SessionStart' in after.hooks,
      false,
      'an event left with nothing is removed rather than kept as an empty matcher',
    );
    assert.deepEqual(after.permissions, { allow: ['Bash(npm test)'] }, 'unrelated keys untouched');
  } finally {
    f.cleanup();
  }
});

test('a file the predecessor wholly owned is still removed', () => {
  // The behaviour worth keeping: nothing but predecessor hooks means nothing
  // worth leaving behind.
  const f = fixture({ hooks: { SessionStart: [{ matcher: '', hooks: [{ command: LEGACY_HOOK }] }] } });
  try {
    const { detected, result } = runSettingsItem(f.dir);
    assert.equal(detected, true);
    assert.match(result ?? '', /removed \(file was Construct-only\)/);
    assert.equal(fs.existsSync(f.file), false);
  } finally {
    f.cleanup();
  }
});

test('an already-empty settings.json is not deleted by a cleanup that emptied nothing', () => {
  // The emptiness test may only delete a file it actually emptied; a file that
  // arrived empty was never the predecessor's.
  const f = fixture({});
  try {
    const { detected } = runSettingsItem(f.dir);
    assert.equal(detected, false);
    assert.ok(fs.existsSync(f.file), 'cleanup must not take what it did not put there');
  } finally {
    f.cleanup();
  }
});

test('"construct" appearing in a path is not enough to match', () => {
  // This repo's own hook path contains the word; the launcher signature is
  // anchored on `.construct/` precisely so that is not a match.
  const f = fixture({
    hooks: {
      PostToolUse: [
        {
          matcher: 'Write',
          hooks: [
            { command: 'node /Users/x/Projects/construct/scripts/hooks/repo-gate.mjs' },
            { command: 'node deconstruct/run.mjs hook thing' },
          ],
        },
      ],
    },
  });
  try {
    const { detected } = runSettingsItem(f.dir);
    assert.equal(detected, false, 'neither path is the predecessor launcher');
    assert.ok(fs.existsSync(f.file));
  } finally {
    f.cleanup();
  }
});
