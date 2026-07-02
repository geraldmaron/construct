/**
 * service-op-run-wiring.functional.test.mjs — proves the service tree launches under
 * `op run` when opted in (ADR-0049 Design A).
 *
 * Drives startServices() with an injected spawn function that captures the
 * (command, args) each long-lived service would spawn, and a fake `op` binary on
 * PATH so opCliAvailable() reports present without touching a real 1Password. When
 * CONSTRUCT_OP_ENV_FILE points at a real env-file the cm / OpenCode / copilot-bridge
 * spawns are wrapped as `op run --env-file=… -- <cmd>`; with the var unset the same
 * spawns are byte-for-byte unchanged. A fake-op invocation counter records how many
 * times `op --version` is probed across the wrapped spawns — the cross-process signal
 * observable here without a real vault.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServices } from '../../lib/service-manager.mjs';

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-svc-oprun-'));
  const homeDir = path.join(dir, 'home');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  const envFile = path.join(dir, '.env.op');
  fs.writeFileSync(envFile, 'OPENROUTER_API_KEY=op://vault/item/credential\n');
  const opCounter = path.join(dir, 'op-version-calls');
  const opBin = path.join(binDir, 'op');
  fs.writeFileSync(
    opBin,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'x' >> "${opCounter}"; echo 2.0.0; exit 0; fi\nexit 0\n`,
  );
  fs.chmodSync(opBin, 0o755);
  return { dir, homeDir, binDir, envFile, opCounter };
}

function opVersionCalls(opCounter) {
  try {
    return fs.readFileSync(opCounter, 'utf8').length;
  } catch {
    return 0;
  }
}

function runOptions({ homeDir, spawns, env }) {
  return {
    rootDir: homeDir,
    homeDir,
    describeRuntimeSupportFn: async () => ({ tmux: false, cm: true, opencode: true, gh: false }),
    getRuntimePortsFn: async () => ({ memory: 7070, bridge: 5173, copilotBridge: 5174 }),
    loadConstructEnvFn: () => ({ ...env }),
    spawnDetachedFn: (command, args) => {
      spawns.push({ command, args });
      return { child: { unref() {} }, logPath: '/dev/null' };
    },
    memoryProbeFn: async () => false,
    openCodeProbeFn: async () => false,
    runPressureReleaseFn: () => ({ killed: [] }),
  };
}

async function withEnv(overrides, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('opted in: cm / opencode / copilot spawns are wrapped in op run', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => fs.rmSync(sandbox.dir, { recursive: true, force: true }));

  const spawns = [];
  await withEnv(
    {
      PATH: `${sandbox.binDir}${path.delimiter}${process.env.PATH}`,
      CONSTRUCT_OP_ENV_FILE: sandbox.envFile,
      CONSTRUCT_DOCTOR: 'off',
      CONSTRUCT_ORACLE: 'off',
    },
    () => startServices({
      ...runOptions({ homeDir: sandbox.homeDir, spawns, env: { CONSTRUCT_OP_ENV_FILE: sandbox.envFile } }),
      selected: new Set(['memory', 'opencode']),
    }),
  );

  const cm = spawns.find((s) => s.args.includes('cm'));
  assert.ok(cm, 'cm spawn captured');
  assert.equal(cm.command, 'op');
  assert.deepEqual(cm.args, ['run', `--env-file=${sandbox.envFile}`, '--', 'cm', 'serve', '--port', '7070']);

  const opencode = spawns.find((s) => s.args.includes('opencode'));
  assert.ok(opencode, 'opencode spawn captured');
  assert.equal(opencode.command, 'op');
  assert.deepEqual(opencode.args, ['run', `--env-file=${sandbox.envFile}`, '--', 'opencode', 'serve', '--port', '5173']);

  assert.ok(opVersionCalls(sandbox.opCounter) >= 1, 'fake op --version was probed at least once');
});

test('parent already resolved: per-service spawns are not wrapped again (single op run)', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => fs.rmSync(sandbox.dir, { recursive: true, force: true }));

  const spawns = [];
  await withEnv(
    {
      PATH: `${sandbox.binDir}${path.delimiter}${process.env.PATH}`,
      CONSTRUCT_OP_ENV_FILE: sandbox.envFile,
      CONSTRUCT_OP_RUN_ACTIVE: '1',
      CONSTRUCT_DOCTOR: 'off',
      CONSTRUCT_ORACLE: 'off',
    },
    () => startServices({
      ...runOptions({
        homeDir: sandbox.homeDir,
        spawns,
        env: { CONSTRUCT_OP_ENV_FILE: sandbox.envFile, CONSTRUCT_OP_RUN_ACTIVE: '1' },
      }),
      selected: new Set(['memory', 'opencode']),
    }),
  );

  const cm = spawns.find((s) => s.command === 'cm');
  assert.ok(cm, 'cm spawn captured');
  assert.deepEqual(cm.args, ['serve', '--port', '7070'], 'cm launched directly, not under op run');

  const opencode = spawns.find((s) => s.command === 'opencode');
  assert.ok(opencode, 'opencode spawn captured');
  assert.deepEqual(opencode.args, ['serve', '--port', '5173']);

  assert.ok(!spawns.some((s) => s.command === 'op'), 'no nested op run under the resolved parent');
});

test('not opted in: spawns are unchanged when CONSTRUCT_OP_ENV_FILE is unset', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => fs.rmSync(sandbox.dir, { recursive: true, force: true }));

  const spawns = [];
  await withEnv(
    {
      PATH: `${sandbox.binDir}${path.delimiter}${process.env.PATH}`,
      CONSTRUCT_OP_ENV_FILE: undefined,
      CONSTRUCT_DOCTOR: 'off',
      CONSTRUCT_ORACLE: 'off',
    },
    () => startServices({
      ...runOptions({ homeDir: sandbox.homeDir, spawns, env: {} }),
      selected: new Set(['memory', 'opencode']),
    }),
  );

  const cm = spawns.find((s) => s.command === 'cm');
  assert.ok(cm, 'cm spawn captured');
  assert.deepEqual(cm.args, ['serve', '--port', '7070']);

  const opencode = spawns.find((s) => s.command === 'opencode');
  assert.ok(opencode, 'opencode spawn captured');
  assert.deepEqual(opencode.args, ['serve', '--port', '5173']);

  assert.ok(!spawns.some((s) => s.command === 'op'), 'no spawn was wrapped in op');
  assert.equal(opVersionCalls(sandbox.opCounter), 0, 'op was never probed when not opted in');
});

test('opted in but op absent: spawns are unchanged (never forces 1Password)', async (t) => {
  const sandbox = makeSandbox();
  fs.rmSync(path.join(sandbox.binDir, 'op'), { force: true });
  t.after(() => fs.rmSync(sandbox.dir, { recursive: true, force: true }));

  const spawns = [];
  await withEnv(
    {
      PATH: sandbox.binDir,
      CONSTRUCT_OP_ENV_FILE: sandbox.envFile,
      CONSTRUCT_DOCTOR: 'off',
      CONSTRUCT_ORACLE: 'off',
    },
    () => startServices({
      ...runOptions({ homeDir: sandbox.homeDir, spawns, env: { CONSTRUCT_OP_ENV_FILE: sandbox.envFile } }),
      selected: new Set(['memory', 'opencode']),
    }),
  );

  assert.ok(!spawns.some((s) => s.command === 'op'), 'op wrap is skipped when op binary is absent');
  const cm = spawns.find((s) => s.command === 'cm');
  assert.deepEqual(cm.args, ['serve', '--port', '7070']);
});
