/**
 * tests/functional/session-tracking-refresh.functional.test.mjs — end-to-end
 * coverage for the Stop-time tracking-refresh hook.
 *
 * Spawns lib/hooks/session-tracking-refresh.mjs in a tmpdir seeded with a
 * minimal Construct project layout (.cx/, context.md, plan.md, an
 * observation file). PATH-shimmed `bd` answers `list` and `show` queries.
 *
 * Contracts:
 *   1. The hook only runs inside Construct projects (.cx/ present).
 *   2. `.cx/context.md` Active Work section reflects the current open-bead
 *      set after the hook runs.
 *   3. When all referenced beads are closed and plan.md is idle, plan.md
 *      is archived into `.cx/handoffs/` and reset to the template.
 *   4. Failures are best-effort — exit 0 even when bd is unavailable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const HOOK = join(REPO_ROOT, 'lib', 'hooks', 'session-tracking-refresh.mjs');

function seed(opts = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'session-tracking-refresh-'));
  const shimDir = mkdtempSync(join(tmpdir(), 'session-tracking-shims-'));
  if (opts.withCx !== false) {
    mkdirSync(join(cwd, '.cx'), { recursive: true });
    writeFileSync(
      join(cwd, '.cx', 'context.md'),
      [
        '# project context',
        '',
        '## Active Work',
        '',
        '_None in progress._',
        '',
        '## Recent Decisions',
        '',
        '_No recent decisions captured._',
        '',
        '## Architecture Notes',
        '',
        '_No new architecture notes._',
        '',
        '## Open Questions',
        '',
        '- pre-existing question',
        '',
      ].join('\n'),
    );
    writeFileSync(join(cwd, '.cx', 'context.json'), JSON.stringify({ format: 'json' }));
  }
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd });
  return {
    cwd,
    shimDir,
    cleanup: () => {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(shimDir, { recursive: true, force: true });
    },
  };
}

function writeShim(shimDir, name, body) {
  writeFileSync(join(shimDir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function runHook({ cwd, shimDir }) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
    },
    input: JSON.stringify({ cwd }),
    encoding: 'utf8',
    timeout: 15_000,
  });
}

test('session-tracking-refresh is a no-op outside Construct projects', () => {
  const env = seed({ withCx: false });
  try {
    writeShim(env.shimDir, 'bd', 'echo "[]"');
    const r = runHook(env);
    assert.equal(r.status, 0);
    assert.equal(existsSync(join(env.cwd, '.cx', 'context.md')), false);
  } finally {
    env.cleanup();
  }
});

test('session-tracking-refresh updates .cx/context.md Active Work from open beads', () => {
  const env = seed();
  try {
    writeShim(env.shimDir, 'bd', `
if [[ "$1" == "list" && "$3" == "in_progress" ]]; then
  echo '[{"id":"construct-active1","title":"feature in flight","status":"in_progress"}]'
  exit 0
fi
echo "[]"
`);
    const r = runHook(env);
    assert.equal(r.status, 0);
    const contextMd = readFileSync(join(env.cwd, '.cx', 'context.md'), 'utf8');
    assert.match(contextMd, /\*\*construct-active1\*\* · feature in flight/);
    assert.match(contextMd, /pre-existing question/, 'Open Questions must be preserved');
  } finally {
    env.cleanup();
  }
});

test('session-tracking-refresh stamps context.json with lastRefreshAt', () => {
  const env = seed();
  try {
    writeShim(env.shimDir, 'bd', 'echo "[]"');
    runHook(env);
    const json = JSON.parse(readFileSync(join(env.cwd, '.cx', 'context.json'), 'utf8'));
    assert.ok(json.lastRefreshAt, 'lastRefreshAt must be set');
    assert.ok(new Date(json.lastRefreshAt).getTime() > 0);
  } finally {
    env.cleanup();
  }
});

test('session-tracking-refresh archives plan.md when every referenced bead is closed and plan is idle', () => {
  const env = seed();
  try {
    const planPath = join(env.cwd, 'plan.md');
    writeFileSync(planPath, '# plan\n\n- construct-landed: see #110\n');
    const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(planPath, twoHoursAgo, twoHoursAgo);

    writeShim(env.shimDir, 'bd', `
if [[ "$1" == "show" ]]; then echo '{"status":"closed"}'; exit 0; fi
echo "[]"
`);

    const r = runHook(env);
    assert.equal(r.status, 0);
    const handoffs = readdirSync(join(env.cwd, '.cx', 'handoffs'));
    const landedFile = handoffs.find((f) => /-plan-landed\.md$/.test(f));
    assert.ok(landedFile, `expected a -plan-landed.md handoff; got ${handoffs.join(', ')}`);

    const archived = readFileSync(join(env.cwd, '.cx', 'handoffs', landedFile), 'utf8');
    assert.match(archived, /construct-landed/);

    const newPlan = readFileSync(planPath, 'utf8');
    assert.doesNotMatch(newPlan, /construct-landed/, 'plan.md must be reset after archive');
  } finally {
    env.cleanup();
  }
});

test('session-tracking-refresh exits 0 even when bd is missing', () => {
  const env = seed();
  try {
    const r = spawnSync(process.execPath, [HOOK], {
      cwd: env.cwd,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
      input: JSON.stringify({ cwd: env.cwd }),
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stderr: ${r.stderr}`);
  } finally {
    env.cleanup();
  }
});
