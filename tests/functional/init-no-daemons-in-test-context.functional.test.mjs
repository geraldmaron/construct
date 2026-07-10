/**
 * tests/functional/init-no-daemons-in-test-context.functional.test.mjs
 *
 * Regression guard for construct-qn6e: without an explicit --no-start,
 * `construct init` auto-starts the doctor + oracle daemons (spawnDetached +
 * unref in lib/service-manager.mjs) any time it runs non-interactively —
 * which includes every CI run and every test-harness invocation. Those
 * daemons outlive the init process and keep writing under HOME long after
 * the triggering process has exited, leaking state and causing flakiness.
 *
 * lib/init-unified.mjs exports resolveShouldStartServices(), which
 * defaults to no-start when CI=true or NODE_ENV=test, unless --auto-start is
 * passed explicitly; --no-start still always wins. This file spawns the real
 * `construct init` in a NODE_ENV=test child with an isolated HOME/
 * CX_HOME_OVERRIDE (sterileSpawnEnv) and asserts no doctor/oracle state file
 * appears under that sandbox — proving startServices was never reached, not
 * just that the daemons happened to exit quickly. The --auto-start override
 * and the --no-start floor are covered at the unit level directly against
 * resolveShouldStartServices, since actually spawning the real detached
 * daemons here would leave live background processes outliving the test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { resolveShouldStartServices } from '../../lib/init-unified.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'init-no-daemons-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, HOME, project, cleanup() { rmTmpDir(root); } };
}

function initGitRepo(cwd) {
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd });
  spawnSync('git', ['config', 'user.email', 'no-daemons@example.com'], { cwd });
  spawnSync('git', ['config', 'user.name', 'No Daemons Test'], { cwd });
}

function runInit(env, extraArgs = []) {
  initGitRepo(env.project);
  return spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', ...extraArgs],
    {
      cwd: env.project,
      encoding: 'utf8',
      timeout: 120_000,
      env: sterileSpawnEnv({
        HOME: env.HOME,
        USERPROFILE: env.HOME,
        CX_HOME_OVERRIDE: env.HOME,
        XDG_CONFIG_HOME: join(env.HOME, '.config'),
        XDG_DATA_HOME: join(env.HOME, '.local', 'share'),
        XDG_CACHE_HOME: join(env.HOME, '.cache'),
        XDG_STATE_HOME: join(env.HOME, '.local', 'state'),
        XDG_RUNTIME_DIR: join(env.HOME, 'run'),
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        NODE_ENV: 'test',
      }),
    },
  );
}

// Doctor state lives at <XDG state>/construct/doctor.json; oracle's heartbeat at
// <XDG state>/construct/runtime/oracle/heartbeat.json (lib/config/xdg.mjs,
// lib/oracle/index.mjs). Both are written by the daemon process itself after it
// starts, so their absence proves startServices (and therefore spawnDetached)
// was never reached — not merely that a spawned daemon happened to exit fast.

function daemonStatePaths(HOME) {
  const stateRoot = join(HOME, '.local', 'state', 'construct');
  return {
    doctorState: join(stateRoot, 'doctor.json'),
    oracleHeartbeat: join(stateRoot, 'runtime', 'oracle', 'heartbeat.json'),
    runtimeLogDir: join(stateRoot, 'runtime'),
  };
}

test('construct init does not auto-start daemons by default under NODE_ENV=test', (t) => {
  const env = sandbox();
  t.after(env.cleanup);

  const result = runInit(env);
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}`);

  const { doctorState, oracleHeartbeat, runtimeLogDir } = daemonStatePaths(env.HOME);
  assert.equal(existsSync(doctorState), false, 'doctor.json must not exist — the doctor daemon must never have started');
  assert.equal(existsSync(oracleHeartbeat), false, 'oracle heartbeat.json must not exist — the oracle daemon must never have started');

  // doctor.log / oracle-daemon.log are written by spawnDetached() itself before
  // the child even runs, so their absence is the stronger, earlier proof that
  // startDoctor/startOracle were never called at all.
  if (existsSync(runtimeLogDir)) {
    const entries = readdirSync(runtimeLogDir);
    assert.ok(!entries.includes('doctor.log'), 'doctor.log must not exist — spawnDetached must never have run for doctor');
    assert.ok(!entries.includes('oracle-daemon.log'), 'oracle-daemon.log must not exist — spawnDetached must never have run for oracle');
  }

  assert.match(result.stdout, /construct dev/, 'suppressed auto-start should point the user at the manual `construct dev` path');
});

test('resolveShouldStartServices: --no-start always wins, regardless of context', () => {
  assert.equal(
    resolveShouldStartServices({ args: ['--no-start'], interactive: false, env: { CI: 'true' } }),
    false,
  );
  assert.equal(
    resolveShouldStartServices({ args: ['--no-start', '--auto-start'], interactive: false, env: {} }),
    false,
    '--no-start must beat --auto-start too',
  );
});

test('resolveShouldStartServices: CI/NODE_ENV=test contexts default to no-start', () => {
  assert.equal(
    resolveShouldStartServices({ args: [], interactive: false, env: { CI: 'true' } }),
    false,
    'CI=true must suppress the default auto-start',
  );
  assert.equal(
    resolveShouldStartServices({ args: [], interactive: false, env: { NODE_ENV: 'test' } }),
    false,
    'NODE_ENV=test must suppress the default auto-start',
  );
});

test('resolveShouldStartServices: --auto-start forces a start even in CI/test contexts (positive control)', () => {
  assert.equal(
    resolveShouldStartServices({ args: ['--auto-start'], interactive: false, env: { CI: 'true' } }),
    true,
    '--auto-start must override the CI default',
  );
  assert.equal(
    resolveShouldStartServices({ args: ['--auto-start'], interactive: true, env: { NODE_ENV: 'test' } }),
    true,
    '--auto-start must override the NODE_ENV=test default even when interactive',
  );
});

test('resolveShouldStartServices: prior non-interactive-defaults-to-start behavior is unchanged outside CI/test', () => {
  assert.equal(
    resolveShouldStartServices({ args: [], interactive: false, env: {} }),
    true,
    'a non-interactive run outside CI/test still auto-starts by default (unchanged behavior)',
  );
  assert.equal(
    resolveShouldStartServices({ args: [], interactive: true, env: {} }),
    false,
    'an interactive run still defaults to no-start (unchanged behavior)',
  );
});
