/**
 * tests/hooks/committed-hooks.test.ts — every host hook this repository commits
 * runs cleanly from any directory inside the checkout.
 *
 * Hosts run a hook command with the session's working directory, which is often
 * a subdirectory, and they surface a non-zero exit as an error on every tool
 * call. A hook that imports a deleted module, or names its script by a path
 * relative to the repository root, therefore fails for every Write and Edit in
 * every session until someone notices. Cursor imports `.claude/settings.json`
 * hooks as well, so one broken entry reaches two hosts.
 *
 * The checker runs each committed command-type hook through `sh -c` with the cwd
 * set to `src/`, `CLAUDE_PROJECT_DIR` set to the checkout, and a PostToolUse
 * payload on stdin. The second test proves the checker would catch the failure
 * class: a hook whose script imports a module that does not exist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sterile } from '../harness/sterile.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** Host hook files a checkout may commit, with the shape each one uses. */
const HOOK_FILES = ['.claude/settings.json', '.cursor/hooks.json'] as const;

interface HookFailure {
  readonly file: string;
  readonly command: string;
  readonly status: number | null;
  readonly output: string;
}

/** Collect every `command` string under a hooks block, whatever the nesting. */
function commandsIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) commandsIn(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'command' && typeof inner === 'string') out.push(inner);
      else commandsIn(inner, out);
    }
  }
  return out;
}

function payloadFor(root: string): string {
  return JSON.stringify({
    session_id: 'committed-hooks-test',
    hook_event_name: 'PostToolUse',
    cwd: join(root, 'src'),
    tool_name: 'Edit',
    tool_input: { file_path: join(root, 'src', 'index.ts'), old_string: 'a', new_string: 'b' },
  });
}

/** Run every committed hook command in `root` the way a host would. */
function failingHooks(root: string): HookFailure[] {
  const failures: HookFailure[] = [];
  const cwd = join(root, 'src');
  for (const file of HOOK_FILES) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { hooks?: unknown };
    for (const command of commandsIn(parsed.hooks)) {
      const run = spawnSync('sh', ['-c', command], {
        cwd,
        input: payloadFor(root),
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      });
      if (run.status !== 0) {
        failures.push({ file, command, status: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.slice(0, 400) });
      }
    }
  }
  return failures;
}

test('every committed host hook exits 0 from a subdirectory of the checkout', () => {
  assert.deepEqual(failingHooks(REPO), []);
});

test('the checker catches a hook whose script imports a module that no longer exists', () => {
  const fixture = sterile();
  try {
    mkdirSync(join(fixture.root, 'src'), { recursive: true });
    mkdirSync(join(fixture.root, 'scripts'), { recursive: true });
    mkdirSync(join(fixture.root, '.claude'), { recursive: true });
    writeFileSync(
      join(fixture.root, 'scripts', 'lint.mjs'),
      "import { gone } from '../src/removed/module.ts';\ngone();\n",
    );
    writeFileSync(
      join(fixture.root, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/lint.mjs"' }] }],
        },
      }),
    );
    const failures = failingHooks(fixture.root);
    assert.equal(failures.length, 1);
    assert.match(failures[0]!.output, /ERR_MODULE_NOT_FOUND|Cannot find module/);
  } finally {
    fixture.cleanup();
  }
});

test('the checker catches a hook that names its script relative to the checkout root', () => {
  const fixture = sterile();
  try {
    mkdirSync(join(fixture.root, 'src'), { recursive: true });
    mkdirSync(join(fixture.root, 'scripts'), { recursive: true });
    mkdirSync(join(fixture.root, '.claude'), { recursive: true });
    writeFileSync(join(fixture.root, 'scripts', 'ok.mjs'), 'process.exit(0);\n');
    writeFileSync(
      join(fixture.root, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'node scripts/ok.mjs' }] }] } }),
    );
    assert.equal(failingHooks(fixture.root).length, 1);
  } finally {
    fixture.cleanup();
  }
});
