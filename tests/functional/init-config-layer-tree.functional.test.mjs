/**
 * tests/functional/init-config-layer-tree.functional.test.mjs — per-layer tree
 * pin for what `construct init` writes at each footprint layer
 * (construct-rf26.22, extending construct-rf26.15/ADR-0066 coverage in
 * tests/functional/state-root-footprint.functional.test.mjs and
 * tests/functional/init-host-footprint.functional.test.mjs).
 *
 * The existing tests assert properties (no heavy dirs, text-sized files, guide
 * placement); none pins the tree itself, so a new init-time write landing in
 * the wrong layer passes them all. One real init against an isolated
 * HOME/CX_HOME_OVERRIDE, then three layer assertions on durable artifacts:
 *   - config layer (.cx/): the exact entry set, nothing more — a new entry
 *     here must be a deliberate, reviewed footprint change;
 *   - machine layer (<home>/.construct): does not exist at all after init —
 *     machine-scoped state is strictly lazy, materialized by the first
 *     durable write (state-root-footprint.functional.test.mjs pins where that
 *     first write lands), never eagerly by init;
 *   - project config files (construct.config.json, .mcp.json): parseable,
 *     declarative, and machine-independent — no absolute sandbox path baked
 *     in, so a committed config layer is portable across machines.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isolationEnv } from '../helpers/isolation-contract.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function makeFixture() {
  const project = mkdtempSync(join(tmpdir(), 'init-config-layer-project-'));
  const home = mkdtempSync(join(tmpdir(), 'init-config-layer-home-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  spawnSync('git', ['config', 'user.email', 'config-layer@example.com'], { cwd: project });
  spawnSync('git', ['config', 'user.name', 'Config Layer Test'], { cwd: project });
  return {
    project,
    home,
    cleanup: () => {
      rmTmpDir(project);
      rmTmpDir(home);
    },
  };
}

function walkRelPaths(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = full.slice(base.length + 1);
    if (statSync(full).isDirectory()) {
      out.push(`${rel}/`);
      out.push(...walkRelPaths(full, base));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

test('construct init writes each footprint layer exactly: pinned .cx/ tree, no machine layer, portable config files', (t) => {
  const { project, home, cleanup } = makeFixture();
  t.after(cleanup);

  const env = isolationEnv(home, { CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1' });
  const result = spawnSync(process.execPath, [BIN, 'init', '--yes', '--no-start'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 120_000,
    env,
  });
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}`);

  // Config layer: the exact .cx/ entry set a default `init --yes` produces.
  // Set equality (not subset) is deliberate: an entry appearing here means the
  // committed config-layer footprint changed and this pin must be updated in
  // the same review, not discovered later on user machines.

  assert.deepEqual(
    walkRelPaths(join(project, '.cx')),
    [
      'construct_guide.md',
      'context.json',
      'context.md',
      'intake/',
      'intake/manifest.json',
      'workflow.json',
    ],
    'the .cx/ config layer must contain exactly the pinned entry set',
  );

  // Machine layer: strictly lazy. Not "no heavy subdirectory" (the existing
  // pin) but no <home>/.construct at all — init performs zero machine-scoped
  // writes, and no legacy <home>/.cx root reappears either.

  assert.equal(existsSync(join(home, '.construct')), false, 'init must not create <home>/.construct — the machine layer materializes on first durable write, not at init');
  assert.equal(existsSync(join(home, '.cx')), false, 'init must not create a legacy <home>/.cx root');

  // Project config files: parseable and declarative.

  const configRaw = readFileSync(join(project, 'construct.config.json'), 'utf8');
  const config = JSON.parse(configRaw);
  assert.equal(config.version, 1, 'construct.config.json must carry the config schema version');
  assert.ok(config.deployment && typeof config.deployment.mode === 'string', 'construct.config.json must declare a deployment mode');
  assert.ok(config.orchestration && typeof config.orchestration.workerBackend === 'string', 'construct.config.json must declare an orchestration worker backend');

  const mcpRaw = readFileSync(join(project, '.mcp.json'), 'utf8');
  assert.doesNotThrow(() => JSON.parse(mcpRaw), '.mcp.json must be valid JSON');

  // Portability: a committed config layer must not embed this machine's
  // absolute home or project path (checked in both symlinked and realpath'd
  // tmpdir forms) — a teammate cloning the repo gets the same layer. An
  // absolute path to the construct install root (.mcp.json's server command)
  // is expected and deliberately not covered by this pin.

  const sandboxPaths = [home, project, realpathSync(home), realpathSync(project)];
  for (const [name, raw] of [['construct.config.json', configRaw], ['.mcp.json', mcpRaw]]) {
    for (const p of sandboxPaths) {
      assert.ok(!raw.includes(p), `${name} must not embed the sandbox path ${p}`);
    }
  }
});
