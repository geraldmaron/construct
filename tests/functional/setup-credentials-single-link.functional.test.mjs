/**
 * tests/functional/setup-credentials-single-link.functional.test.mjs
 *
 * Guards construct-trxz.7: `node scripts/setup-credentials.mjs` must invoke
 * `op item list` at most once per run. The env-prep step is a presence-check
 * (no autoLink); only the explicit force+autoLink call links from 1Password.
 *
 * Real-process boundary: spawns the actual script with a fake `op` on PATH that
 * tallies every `item list` exec into a log file, then asserts a single tally.
 * Uses an isolated HOME/cwd and strips ambient credential + test env so the
 * bootstrap sees all keys missing and reaches the link path. Never touches the
 * real 1Password CLI.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const setupScript = path.join(repoRoot, 'scripts', 'setup-credentials.mjs');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A fake `op` that returns an empty item list and appends one line to OP_CALL_LOG
// per `item list` exec, so the test counts how many times the script reached the
// 1Password link path.

function installFakeOp(binDir, logPath) {
  const opPath = path.join(binDir, 'op');
  const script = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const args = process.argv.slice(2);',
    'if (args[0] === "item" && args[1] === "list") {',
    '  fs.appendFileSync(process.env.OP_CALL_LOG, "list\\n");',
    '  process.stdout.write("[]");',
    '}',
    'process.exit(0);',
  ].join('\n');
  fs.writeFileSync(opPath, script);
  fs.chmodSync(opPath, 0o755);
}

test('setup-credentials runs op item list exactly once per invocation', (t) => {
  const home = makeTmpDir('cx-setup-cred-home-');
  const cwd = makeTmpDir('cx-setup-cred-cwd-');
  const binDir = makeTmpDir('cx-setup-cred-bin-');
  t.after(() => {
    for (const d of [home, cwd, binDir]) {
      try { rmTmpDir(d); } catch {}
    }
  });
  const logPath = path.join(binDir, 'op-calls.log');
  fs.writeFileSync(logPath, '');
  installFakeOp(binDir, logPath);

  const env = { ...process.env };
  for (const key of [
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY',
    'GITHUB_TOKEN', 'GH_TOKEN', 'CX_USER_ENV_PATH', 'XDG_CONFIG_HOME', 'CONSTRUCT_OP_ENV_FILE',
    'NODE_ENV', 'CI',
  ]) {
    delete env[key];
  }
  env.HOME = home;
  env.OP_CALL_LOG = logPath;
  env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;

  const result = spawnSync(process.execPath, [setupScript], { cwd, env, encoding: 'utf8' });

  assert.equal(result.status, 0, `script exited non-zero: ${result.stderr}`);
  const calls = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length;
  assert.equal(calls, 1, `op item list ran ${calls} times; expected exactly 1`);
});
