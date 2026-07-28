/**
 * tests/functional/openrouter-llm-live-gate.functional.test.mjs — file-tier key
 * resolution in the live-LLM harness must stay opt-in gated behind
 * CONSTRUCT_CERTIFY_LIVE=1, so a plain `npm test` never picks up a real key
 * from ~/.construct/config.env and silently goes live.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLlmHarness } from './_lib/openrouter-llm.mjs';
import { LIVE_OPT_IN_ENV } from '../../lib/certification/runner.mjs';
import { __clearSecretCache } from '../../lib/providers/secret-resolver.mjs';
import { configDir } from '../../lib/config/xdg.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function withTmpHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-llm-gate-'));
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalOptIn = process.env[LIVE_OPT_IN_ENV];
  process.env.HOME = home;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env[LIVE_OPT_IN_ENV];
  __clearSecretCache();
  try {
    const constructDir = configDir(home);
    fs.mkdirSync(constructDir, { recursive: true });
    fs.writeFileSync(path.join(constructDir, 'config.env'), 'OPENROUTER_API_KEY=fixture-file-tier-canary\n');
    return fn(home);
  } finally {
    process.env.HOME = originalHome;
    process.chdir(originalCwd);
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalOptIn === undefined) delete process.env[LIVE_OPT_IN_ENV];
    else process.env[LIVE_OPT_IN_ENV] = originalOptIn;
    __clearSecretCache();
    rmTmpDir(home);
  }
}

test('plain npm test cannot resolve a file-tier key without live opt-in', () => {
  withTmpHome(() => {
    const harness = createLlmHarness();
    assert.equal(harness.available, false);
    assert.match(harness.skipReason, /OPENROUTER_API_KEY not set/);
  });
});

test('CONSTRUCT_CERTIFY_LIVE=1 restores file-tier key resolution', () => {
  withTmpHome(() => {
    process.env[LIVE_OPT_IN_ENV] = '1';
    __clearSecretCache();
    const harness = createLlmHarness();
    assert.equal(harness.available, true);
  });
});

test('an explicitly exported OPENROUTER_API_KEY works without the opt-in', () => {
  withTmpHome(() => {
    process.env.OPENROUTER_API_KEY = 'fixture-explicit-export-canary';
    const harness = createLlmHarness();
    assert.equal(harness.available, true);
  });
});
