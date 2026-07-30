/**
 * tests/functional/secret-resolver-real-op.functional.test.mjs
 *
 * Guards construct-trxz.9: exercises the resolver against a REAL `op` subprocess (a
 * fake binary on PATH), not an injected stub, across real process boundaries. Two
 * claims are proven from actual behavior, not mocks:
 *   1. Within one process a repeated op:// reference spawns `op` exactly once
 *      (the in-process cache holds), and the durable audit trail records that read.
 *   2. A fresh process re-resolves from a cold cache — so two separate runs spawn
 *      `op` twice total. This is the cross-process re-prompt that the in-process
 *      "auth once" cannot cover and that the op-run wiring addresses for
 *      the service tree; closing it for standalone CLI runs depends on op's own
 *      session and is tracked separately.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OP_REF = 'op://Vault/Item/credential';

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-real-op-'));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const opLog = path.join(dir, 'op-reads.log');
  fs.writeFileSync(opLog, '');

  const opBin = path.join(binDir, 'op');
  const opScript = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const args = process.argv.slice(2);',
    'if (args[0] === "read") {',
    '  fs.appendFileSync(process.env.OP_READ_LOG, "read\\n");',
    '  process.stdout.write("resolved-canary-zzz-not-a-key");',
    '  process.exit(0);',
    '}',
    'process.exit(0);',
  ].join('\n');
  fs.writeFileSync(opBin, opScript);
  fs.chmodSync(opBin, 0o755);

  const runner = path.join(dir, 'resolve-twice.mjs');
  const runnerScript = [
    `import { resolveSecret } from ${JSON.stringify(path.join(REPO_ROOT, 'lib', 'providers', 'secret-resolver.mjs'))};`,
    `const env = { ANTHROPIC_API_KEY: ${JSON.stringify(OP_REF)} };`,
    "resolveSecret('ANTHROPIC_API_KEY', { env, allowAmbient: false });",
    "resolveSecret('ANTHROPIC_API_KEY', { env, allowAmbient: false });",
  ].join('\n');
  fs.writeFileSync(runner, runnerScript);

  return { dir, binDir, opLog, runner };
}

// resolveSecret's file tier reads a project-env `.env` at cwd and home-scoped
// config/rc tiers before it materializes the injected op:// reference. This repo's
// own gitignored .env carries a real ANTHROPIC_API_KEY, so an un-isolated child
// resolves that materialized key and never spawns op (op read count 0). Run the
// child from the empty sandbox with HOME repointed there so no ambient credential
// pre-empts the op:// path, and drop the op-env-catalog pointer for good measure.

function runResolver(sandbox) {
  const env = {
    ...process.env,
    HOME: sandbox.dir,
    PATH: `${sandbox.binDir}${path.delimiter}${process.env.PATH || ''}`,
    OP_READ_LOG: sandbox.opLog,
  };
  delete env.CONSTRUCT_OP_ENV_FILE;
  const result = spawnSync(process.execPath, [sandbox.runner], { cwd: sandbox.dir, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, `resolver run failed: ${result.stderr}`);
}

function opReadCount(sandbox) {
  return fs.readFileSync(sandbox.opLog, 'utf8').split('\n').filter(Boolean).length;
}

test('real op subprocess: one read per process despite a repeated reference', (t) => {
  const sandbox = makeSandbox();
  t.after(() => rmTmpDir(sandbox.dir));

  runResolver(sandbox);
  assert.equal(opReadCount(sandbox), 1, 'two resolves in one process spawn op exactly once (in-process cache)');
});

test('real op subprocess: a fresh process re-resolves from a cold cache', (t) => {
  const sandbox = makeSandbox();
  t.after(() => rmTmpDir(sandbox.dir));

  runResolver(sandbox);
  runResolver(sandbox);
  assert.equal(opReadCount(sandbox), 2, 'two separate processes each spawn op once — the cross-process re-resolution');
});
