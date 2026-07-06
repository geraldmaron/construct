/**
 * tests/functional/opencode-config-path.functional.test.mjs
 *
 * Guards construct-09tf: OpenCode's config resolver reads `<project>/opencode.json`,
 * `opencode.jsonc`, or `<project>/.opencode/opencode.json` — never `.opencode/config.json`.
 * Project sync must therefore write `.opencode/opencode.json` (with the `agent` and
 * `mcp` keys OpenCode loads), must not leave the silently-ignored `.opencode/config.json`,
 * and must migrate a stale `.opencode/config.json` from a prior install onto the
 * canonical name without dropping content.
 *
 * Spawns the real sync-specialists.mjs into an isolated HOME + project; OpenCode is
 * never executed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-specialists.mjs');

// The canonical per-project paths OpenCode's resolver actually reads (opencode.ai
// config docs + the v1.15.4 binary's embedded resolver). `.opencode/config.json`
// is deliberately absent.

const RESOLVER_PROJECT_PATHS = ['opencode.json', 'opencode.jsonc', '.opencode/opencode.json'];

function makeEnv() {
  const sandbox = mkdtempSync(join(tmpdir(), 'opencode-path-'));
  const HOME = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  return { sandbox, HOME, project, cleanup() { rmTmpDir(sandbox); } };
}

function runSync(env) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, '--project'], {
    cwd: env.project,
    encoding: 'utf8',
    timeout: 90_000,
    // Pin opencode so the project sync writes its adapter regardless of whether
    // the runner has the opencode binary — the detected-only default (ADR-0027
    // §1) would otherwise skip it on a host-less CI runner.
    env: { ...process.env, HOME: env.HOME, CONSTRUCT_SKIP_POSTINSTALL: '1', CONSTRUCT_SYNC_HOSTS: 'claude,opencode' },
  });
}

test('project sync writes .opencode/opencode.json (resolver-recognized) with agent + mcp, not config.json', () => {
  const env = makeEnv();
  try {
    const result = runSync(env);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const canonical = join(env.project, '.opencode', 'opencode.json');
    const legacy = join(env.project, '.opencode', 'config.json');

    assert.ok(existsSync(canonical), 'must write .opencode/opencode.json');
    assert.ok(!existsSync(legacy), 'must not write .opencode/config.json (OpenCode never reads it)');
    assert.ok(RESOLVER_PROJECT_PATHS.includes('.opencode/opencode.json'), 'written path is a resolver candidate');

    const config = JSON.parse(readFileSync(canonical, 'utf8'));
    assert.ok(config.agent && Object.keys(config.agent).length === 4, 'agent table present with orchestrator + helper agents');
    assert.ok(config.agent.construct, 'orchestrator present');
    assert.ok(config.agent.title, 'title helper present');
    assert.ok(config.agent.summary, 'summary helper present');
    assert.ok(config.agent.compaction, 'compaction helper present');
    assert.ok(config.mcp && Object.keys(config.mcp).length >= 1, 'mcp servers present');
  } finally {
    env.cleanup();
  }
});

test('a stale .opencode/config.json from a prior install is migrated to opencode.json without losing content', () => {
  const env = makeEnv();
  try {
    mkdirSync(join(env.project, '.opencode'), { recursive: true });
    writeFileSync(
      join(env.project, '.opencode', 'config.json'),
      JSON.stringify({ provider: { custom: { note: 'user-kept' } }, agent: {} }, null, 2),
    );

    const result = runSync(env);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const canonical = join(env.project, '.opencode', 'opencode.json');
    const legacy = join(env.project, '.opencode', 'config.json');

    assert.ok(existsSync(canonical), 'migrated to .opencode/opencode.json');
    assert.ok(!existsSync(legacy), 'stale .opencode/config.json removed');

    const config = JSON.parse(readFileSync(canonical, 'utf8'));
    assert.equal(config.provider?.custom?.note, 'user-kept', 'pre-existing content preserved through migration');
    assert.ok(config.agent && Object.keys(config.agent).length === 4, 'construct orchestrator + helper agents merged in');
  } finally {
    env.cleanup();
  }
});
