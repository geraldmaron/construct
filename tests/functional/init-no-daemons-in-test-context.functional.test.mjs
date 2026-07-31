/**
 * tests/functional/init-no-daemons-in-test-context.functional.test.mjs
 *
 * Two-layer guard that `construct init` spawns zero background daemons
 * (the Doctor/Oracle
 * daemon spawn paths from lib/service-manager.mjs entirely — the legacy
 * daemons are retired and must never run).
 *
 * Layer 1 spawns the real `construct init` in a NODE_ENV=test child with an
 * isolated HOME/CONSTRUCT_HOME_OVERRIDE (sterileSpawnEnv) and asserts no
 * doctor/oracle state file appears under that sandbox AND that no process in
 * the live process table references the sandbox root — a real-process proof
 * scoped to this test's own HOME, so concurrently leaked daemons from other
 * suites can never flake it. Layer 2 drives the real startServices() with a
 * hermetic support probe (every optional service absent) and asserts it
 * reports no Doctor/Oracle service and leaves no daemon log or state behind
 * — the spawn functions are deleted, so no env-var gate is involved.
 *
 * resolveShouldStartServices() still gates which contexts run startServices
 * at all (CI/NODE_ENV=test default to no-start; --no-start always wins;
 * --auto-start forces); those unit cases are pinned here too.
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
import { startServices } from '../../lib/service-manager.mjs';

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
        CONSTRUCT_HOME_OVERRIDE: env.HOME,
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
// starts, so their absence proves the daemon never ran — not merely that a
// spawned daemon happened to exit fast.

function daemonStatePaths(HOME) {
  const stateRoot = join(HOME, '.local', 'state', 'construct');
  return {
    doctorState: join(stateRoot, 'doctor.json'),
    oracleHeartbeat: join(stateRoot, 'runtime', 'oracle', 'heartbeat.json'),
    runtimeLogDir: join(stateRoot, 'runtime'),
  };
}

// Real-process proof scoped to one sandbox: any detached daemon this test's
// init spawned would carry the sandbox root in its command line (log fd path,
// cwd argument, or module path) — matching on the sandbox root means daemons
// leaked by concurrent suites (other HOMEs) can never flake this assertion.

function processesReferencing(rootPath) {
  const result = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return (result.stdout || '').split('\n').filter((line) => line.includes(rootPath));
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
  // no daemon spawn was ever attempted.
  if (existsSync(runtimeLogDir)) {
    const entries = readdirSync(runtimeLogDir);
    assert.ok(!entries.includes('doctor.log'), 'doctor.log must not exist — spawnDetached must never have run for doctor');
    assert.ok(!entries.includes('oracle-daemon.log'), 'oracle-daemon.log must not exist — spawnDetached must never have run for oracle');
  }

  const leaked = processesReferencing(env.root);
  assert.deepEqual(leaked, [], `no live process may reference the sandbox root after init: ${leaked.join(' | ')}`);

  assert.match(result.stdout, /construct dev/, 'suppressed auto-start should point the user at the manual `construct dev` path');
});

test('startServices spawns no Doctor or Oracle daemon in any context (spawn paths removed)', async (t) => {
  const env = sandbox();
  t.after(env.cleanup);

  const { results } = await startServices({
    rootDir: env.project,
    homeDir: env.HOME,
    describeRuntimeSupportFn: async () => ({ tmux: false, cm: false, opencode: false, gh: false }),
    getRuntimePortsFn: async () => ({ memory: 0, bridge: 0, copilotBridge: 0 }),
    loadConstructEnvFn: () => ({}),
    memoryProbeFn: async () => false,
    openCodeProbeFn: async () => false,
    runPressureReleaseFn: () => ({ killed: [] }),
  });

  const names = results.map((r) => r.name);
  assert.ok(!names.includes('Doctor'), `startServices must not report a Doctor service: ${names.join(', ')}`);
  assert.ok(!names.includes('Oracle'), `startServices must not report an Oracle service: ${names.join(', ')}`);

  const { doctorState, oracleHeartbeat, runtimeLogDir } = daemonStatePaths(env.HOME);
  assert.equal(existsSync(doctorState), false, 'startServices must not create doctor.json');
  assert.equal(existsSync(oracleHeartbeat), false, 'startServices must not create the oracle heartbeat');
  if (existsSync(runtimeLogDir)) {
    const entries = readdirSync(runtimeLogDir);
    assert.ok(!entries.includes('doctor.log'), 'startServices must not open a doctor.log');
    assert.ok(!entries.includes('oracle-daemon.log'), 'startServices must not open an oracle-daemon.log');
  }

  const leaked = processesReferencing(env.root);
  assert.deepEqual(leaked, [], `no live process may reference the sandbox root after startServices: ${leaked.join(' | ')}`);
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
