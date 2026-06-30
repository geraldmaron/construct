/**
 * tests/functional/credentials-diagnostics-no-leak.functional.test.mjs
 *
 * Guards construct-trxz.2: the `construct doctor credentials` diagnostics are
 * presence-only. They must not print any byte of a secret value and must not
 * invoke `op` (no biometric prompt) just to render diagnostics.
 *
 * Real-process boundary: spawns the actual binary with a known secret in the env
 * and an `op://`-bearing shell rc under an isolated HOME, plus a fake `op` on PATH
 * that tallies any invocation. Asserts presence is reported, the secret value never
 * appears in output, the op:// reference is named but not resolved, and `op` ran
 * zero times.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function installFakeOp(binDir, logPath) {
  const opPath = path.join(binDir, 'op');
  const script = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'fs.appendFileSync(process.env.OP_CALL_LOG, "call\\n");',
    'process.exit(0);',
  ].join('\n');
  fs.writeFileSync(opPath, script);
  fs.chmodSync(opPath, 0o755);
}

test('construct credentials reports presence without leaking values or invoking op', (t) => {
  const home = makeTmpDir('cx-cred-diag-home-');
  const cwd = makeTmpDir('cx-cred-diag-cwd-');
  const binDir = makeTmpDir('cx-cred-diag-bin-');
  t.after(() => {
    for (const d of [home, cwd, binDir]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
  });

  const logPath = path.join(binDir, 'op-calls.log');
  fs.writeFileSync(logPath, '');
  installFakeOp(binDir, logPath);

  const opRef = 'op://DevVault/AnthropicItem/credential';
  fs.writeFileSync(path.join(home, '.zshrc'), `export ANTHROPIC_API_KEY=$(op read '${opRef}')\n`, 'utf8');

  const canary = 'CANARY-zz9-do-not-print-this-value-xx';
  const env = { ...process.env };
  for (const key of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'OPENCODE_API_KEY']) {
    delete env[key];
  }
  env.HOME = home;
  env.OPENROUTER_API_KEY = canary;
  env.OP_CALL_LOG = logPath;
  env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;
  env.CONSTRUCT_SKIP_BOOTSTRAP_PROBE = '1';
  env.BOOTSTRAP_CHECKED = '1';

  const result = spawnSync(process.execPath, [BIN, 'doctor', 'credentials'], {
    cwd, env, encoding: 'utf8', timeout: 120_000,
  });

  const out = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.status, 0, `credentials exited non-zero: ${result.stderr}`);
  assert.match(out, /OPENROUTER_API_KEY/);
  assert.match(out, /process\.env \(set\)/);
  assert.equal(out.includes('CANARY'), false, 'secret value must not appear in output');
  assert.equal(out.includes(canary.slice(0, 8)), false, 'secret prefix must not appear in output');
  assert.equal(out.includes(opRef), false, 'op:// reference path must not be echoed verbatim');
  assert.match(out, /op:\/\/ reference/);

  const opCalls = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length;
  assert.equal(opCalls, 0, `op was invoked ${opCalls} times; diagnostics must not resolve secrets`);
});
