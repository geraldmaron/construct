/**
 * tests/credential-precedence-parity.test.mjs
 *
 * Guards construct-trxz.5: the startup env merge (loadConstructEnv) and the
 * on-demand resolver (secret-resolver) must agree on the file tier. A key set in
 * both the project .env and the user config.env resolves to the project value on
 * both paths, so a credential never resolves to different values depending on which
 * code path reads it.
 *
 * HOME and XDG_CONFIG_HOME are pinned to the sandbox for the run because
 * resolveSecret reads os.homedir()/configDir() directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConstructEnv, getUserEnvPath } from '../lib/env-config.mjs';
import { resolveSecret } from '../lib/providers/secret-resolver.mjs';

test('loadConstructEnv and resolveSecret both prefer project .env over user config.env', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-precedence-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-precedence-proj-'));

  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;

  try {
    const configPath = getUserEnvPath(home);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'PRECEDENCE_PROBE=from-config-env\n', 'utf8');
    fs.writeFileSync(path.join(project, '.env'), 'PRECEDENCE_PROBE=from-project-env\n', 'utf8');

    const merged = loadConstructEnv({ rootDir: project, homeDir: home, env: {}, warn: false });
    const resolved = resolveSecret('PRECEDENCE_PROBE', { env: {}, cwd: project, allowAmbient: true });

    assert.equal(merged.PRECEDENCE_PROBE, 'from-project-env', 'loadConstructEnv prefers project .env');
    assert.equal(resolved, 'from-project-env', 'resolveSecret prefers project .env');
    assert.equal(merged.PRECEDENCE_PROBE, resolved, 'both paths agree');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});
