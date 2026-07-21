/**
 * tests/functional/sync-prune-safety.functional.test.mjs
 *
 * A host excluded from a sync run — whether by explicit `--hosts=` deselection
 * or an auto-detection miss (binary not on PATH) — must never have its prior
 * managed output deleted. Regression coverage for the Codex data-loss bug
 * (construct-lqp4c's copilot precedent, generalized to codex + claude project
 * scope) and an invariant sweep across every host sync-worker-profiles.mjs manages.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-worker-profiles.mjs');
const ALL_HOSTS = ['claude', 'codex', 'copilot', 'opencode', 'vscode', 'cursor'];

// Each host's managed marker path a prior sync would have created, relative
// to the project root, and its own file-existence check.

const HOST_MARKERS = {
  claude: (project) => join(project, '.claude', 'agents', 'construct.md'),
  codex: (project) => join(project, '.codex', 'agents', 'construct.toml'),
  copilot: (project) => join(project, '.github', 'prompts', 'construct.prompt.md'),
  opencode: (project) => join(project, '.opencode', 'opencode.json'),
  vscode: (project) => join(project, '.vscode', 'mcp.json'),
  cursor: (project) => join(project, '.cursor', 'mcp.json'),
};

function makeIsolatedEnv() {
  const sandbox = mkdtempSync(join(tmpdir(), 'sync-prune-safety-'));
  const HOME = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: project });
  return {
    sandbox, HOME, project,
    cleanup() { rmTmpDir(sandbox); },
  };
}

function runSync(env, hosts, extraEnv = {}) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, '--project'], {
    cwd: env.project,
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      HOME: env.HOME,
      CONSTRUCT_SKIP_POSTINSTALL: '1',
      CONSTRUCT_SYNC_HOSTS: hosts.join(','),
      ...extraEnv,
    },
  });
}

for (const excluded of ALL_HOSTS) {
  test(`excluding ${excluded} from a re-sync does not delete its prior managed output`, () => {
    const env = makeIsolatedEnv();
    try {
      const seed = runSync(env, ALL_HOSTS);
      assert.equal(seed.status, 0, `seeding sync failed: ${seed.stderr}`);
      const marker = HOST_MARKERS[excluded](env.project);
      assert.ok(existsSync(marker), `seeding sync must create ${marker}`);

      const rerun = runSync(env, ALL_HOSTS.filter((h) => h !== excluded));
      assert.equal(rerun.status, 0, `re-sync excluding ${excluded} failed: ${rerun.stderr}`);

      assert.ok(existsSync(marker), `${marker} must survive a sync that excludes ${excluded}`);
    } finally {
      env.cleanup();
    }
  });
}

test('Codex config.toml managed agent block survives a re-sync that excludes codex', () => {
  const env = makeIsolatedEnv();
  try {
    const seed = runSync(env, ALL_HOSTS);
    assert.equal(seed.status, 0, `seeding sync failed: ${seed.stderr}`);
    const configPath = join(env.project, '.codex', 'config.toml');
    const before = readFileSync(configPath, 'utf8');
    assert.ok(before.includes('[agents.construct]'), 'seed sync must write the managed agents table');

    const rerun = runSync(env, ALL_HOSTS.filter((h) => h !== 'codex'));
    assert.equal(rerun.status, 0, `re-sync excluding codex failed: ${rerun.stderr}`);

    const after = readFileSync(configPath, 'utf8');
    assert.ok(after.includes('[agents.construct]'), 'config.toml managed agents table must survive excluding codex');
  } finally {
    env.cleanup();
  }
});

test('an undetected Codex (binary off PATH, no --hosts) is still picked up via the config-file fallback and left untouched', () => {
  const env = makeIsolatedEnv();
  try {
    const seed = runSync(env, ALL_HOSTS);
    assert.equal(seed.status, 0, `seeding sync failed: ${seed.stderr}`);
    const marker = HOST_MARKERS.codex(env.project);
    assert.ok(existsSync(marker), 'seeding sync must create the codex adapter');

    // No CONSTRUCT_SYNC_HOSTS this time — auto-detect. A sandboxed PATH with
    // no `codex` binary reproduces the original detection-miss scenario;
    // detection must fall back to the `.codex/agents` dir this project
    // already has from the seed run.
    const rerun = spawnSync(process.execPath, [SYNC_SCRIPT, '--project'], {
      cwd: env.project,
      encoding: 'utf8',
      timeout: 90_000,
      env: {
        PATH: '/usr/bin:/bin',
        HOME: env.HOME,
        CONSTRUCT_SKIP_POSTINSTALL: '1',
      },
    });
    assert.equal(rerun.status, 0, `auto-detect re-sync failed: ${rerun.stderr}`);

    assert.ok(existsSync(marker), 'codex adapter must survive an auto-detect re-sync with the binary off PATH');
  } finally {
    env.cleanup();
  }
});

test('Claude project agent survives a re-sync that excludes claude (project scope, not the Single-Front-Door global sweep)', () => {
  const env = makeIsolatedEnv();
  try {
    const seed = runSync(env, ALL_HOSTS);
    assert.equal(seed.status, 0, `seeding sync failed: ${seed.stderr}`);
    const marker = HOST_MARKERS.claude(env.project);
    assert.ok(existsSync(marker), 'seeding sync must create the claude front-door agent');

    const rerun = runSync(env, ALL_HOSTS.filter((h) => h !== 'claude'));
    assert.equal(rerun.status, 0, `re-sync excluding claude failed: ${rerun.stderr}`);

    assert.ok(existsSync(marker), 'construct.md must survive a project sync that excludes claude');
  } finally {
    env.cleanup();
  }
});

test('global scope still writes no Claude agent file regardless of wants (Single Front Door is unaffected by the prune-safety fix)', () => {
  const env = makeIsolatedEnv();
  try {
    const r = spawnSync(process.execPath, [SYNC_SCRIPT, '--global'], {
      cwd: env.project,
      encoding: 'utf8',
      timeout: 90_000,
      env: {
        ...process.env,
        HOME: env.HOME,
        CONSTRUCT_SKIP_POSTINSTALL: '1',
        CONSTRUCT_SYNC_HOSTS: ALL_HOSTS.join(','),
      },
    });
    assert.equal(r.status, 0, `global sync failed: ${r.stderr}`);

    assert.ok(!existsSync(join(env.HOME, '.claude', 'agents', 'construct.md')), 'global scope must not write a Claude agent file — the project front door is the only one, unrelated to the prune-safety fix');
  } finally {
    env.cleanup();
  }
});
