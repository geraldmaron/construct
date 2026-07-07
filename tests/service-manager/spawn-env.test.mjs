/**
 * tests/service-manager/spawn-env.test.mjs — construct-192h.8 proof.
 *
 * service-manager computed liveEnv (config.env merged over process.env) to decide
 * whether to wrap a service in `op run`, but spawned cm/opencode/copilot WITHOUT it,
 * so config.env-only vars — including CONSTRUCT_OP_ENV_FILE and an
 * OP_SERVICE_ACCOUNT_TOKEN — never reached those children. Every service spawn now
 * carries liveEnv, matching doctor/oracle.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startServices } from '../../lib/service-manager.mjs';

test('[construct-192h.8] cm and opencode spawns receive the merged liveEnv', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-spawn-env-'));
  const calls = [];
  try {
    await startServices({
      rootDir: homeDir,
      homeDir,
      loadConstructEnvFn: () => ({ ...process.env, SENTINEL_VAR: 'sentinel-value', OP_SERVICE_ACCOUNT_TOKEN: 'ops_test_token' }),
      describeRuntimeSupportFn: async () => ({ cm: true, opencode: true, gh: false }),
      getRuntimePortsFn: async () => ({ memory: 39411, bridge: 39412, copilotBridge: 39413 }),
      memoryProbeFn: async () => false,
      openCodeProbeFn: async () => false,
      runPressureReleaseFn: () => ({}),
      spawnDetachedFn: (command, args, home, logFile, options = {}) => {
        calls.push({ logFile, env: options.env });
        return { child: { pid: 4242 }, logPath: path.join(home, logFile) };
      },
    });

    const cm = calls.find((c) => c.logFile === 'cm.log');
    const oc = calls.find((c) => c.logFile === 'opencode.log');
    assert.ok(cm, 'cm service should have been spawned');
    assert.ok(oc, 'opencode service should have been spawned');

    assert.equal(cm.env?.SENTINEL_VAR, 'sentinel-value', 'cm must receive a config.env-only var via liveEnv');
    assert.equal(oc.env?.SENTINEL_VAR, 'sentinel-value', 'opencode must receive a config.env-only var via liveEnv');
    assert.equal(cm.env?.OP_SERVICE_ACCOUNT_TOKEN, 'ops_test_token', 'cm must receive OP_SERVICE_ACCOUNT_TOKEN so its op run is non-interactive');
    assert.equal(oc.env?.OP_SERVICE_ACCOUNT_TOKEN, 'ops_test_token');
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
