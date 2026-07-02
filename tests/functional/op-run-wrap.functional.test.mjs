/**
 * tests/functional/op-run-wrap.functional.test.mjs — opt-in `op run` wrapping.
 *
 * Asserts a launch command is wrapped in `op run` only when CONSTRUCT_OP_ENV_FILE
 * points at a real file and the op CLI is present, and is returned untouched
 * otherwise (1Password never forced). Also covers the parent-resolve path: the
 * CONSTRUCT_OP_RUN_ACTIVE sentinel disables the per-service wrap so a resolution at
 * the parent is not nested, and maybeReExecUnderOpRun re-execs the process exactly
 * once under a single `op run` on the opted-in path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  wrapWithOpRun,
  resolveOpEnvFile,
  maybeReExecUnderOpRun,
  OP_RUN_ACTIVE_ENV,
} from '../../lib/providers/op-run.mjs';

function tmpEnvFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-oprun-'));
  const file = path.join(dir, '.env.op');
  fs.writeFileSync(file, 'OPENROUTER_API_KEY=op://vault/item/credential\n');
  return { dir, file };
}

test('wrapWithOpRun returns the command unchanged when the var is unset', () => {
  const r = wrapWithOpRun('/usr/bin/node', ['server.mjs'], { env: {}, hasOp: () => true });
  assert.equal(r.wrapped, false);
  assert.equal(r.command, '/usr/bin/node');
  assert.deepEqual(r.args, ['server.mjs']);
});

test('wrapWithOpRun does not wrap when op CLI is absent (never forces 1Password)', (t) => {
  const { dir, file } = tmpEnvFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = wrapWithOpRun('/usr/bin/node', ['server.mjs'], { env: { CONSTRUCT_OP_ENV_FILE: file }, hasOp: () => false });
  assert.equal(r.wrapped, false);
  assert.equal(r.command, '/usr/bin/node');
});

test('wrapWithOpRun does not wrap when the env-file is missing', () => {
  const r = wrapWithOpRun('/usr/bin/node', ['server.mjs'], { env: { CONSTRUCT_OP_ENV_FILE: '/no/such/.env.op' }, hasOp: () => true });
  assert.equal(r.wrapped, false);
});

test('wrapWithOpRun wraps in op run when opted in and op is present', (t) => {
  const { dir, file } = tmpEnvFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = wrapWithOpRun('/usr/bin/node', ['server.mjs'], { env: { CONSTRUCT_OP_ENV_FILE: file }, hasOp: () => true });
  assert.equal(r.wrapped, true);
  assert.equal(r.command, 'op');
  assert.deepEqual(r.args, ['run', `--env-file=${file}`, '--', '/usr/bin/node', 'server.mjs']);
});

test('resolveOpEnvFile expands a leading ~ against the home dir', (t) => {
  const { dir, file } = tmpEnvFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const resolved = resolveOpEnvFile({ CONSTRUCT_OP_ENV_FILE: '~/.env.op' }, dir);
  assert.equal(resolved, path.join(dir, '.env.op'));
  assert.equal(resolved, file);
});

test('wrapWithOpRun does not nest when the parent already resolved (sentinel set)', (t) => {
  const { dir, file } = tmpEnvFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = wrapWithOpRun('/usr/bin/node', ['server.mjs'], {
    env: { CONSTRUCT_OP_ENV_FILE: file, [OP_RUN_ACTIVE_ENV]: '1' },
    hasOp: () => true,
  });
  assert.equal(r.wrapped, false);
  assert.equal(r.command, '/usr/bin/node');
  assert.deepEqual(r.args, ['server.mjs']);
});

test('maybeReExecUnderOpRun re-execs once under a single op run when opted in', (t) => {
  const { dir, file } = tmpEnvFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const res = maybeReExecUnderOpRun({
    argv: ['/usr/bin/node', '/opt/construct/bin/construct', 'dev', '--only=memory'],
    execPath: '/usr/bin/node',
    env: { CONSTRUCT_OP_ENV_FILE: file },
    homeDir: dir,
    hasOp: () => true,
    spawnFn: (command, args, opts) => {
      calls.push({ command, args, opts });
      return { status: 0 };
    },
  });
  assert.equal(res.reExecuted, true);
  assert.equal(res.code, 0);
  assert.equal(calls.length, 1, 're-exec spawns exactly one op run');
  assert.equal(calls[0].command, 'op');
  assert.deepEqual(calls[0].args, [
    'run', `--env-file=${file}`, '--',
    '/usr/bin/node', '/opt/construct/bin/construct', 'dev', '--only=memory',
  ]);
  assert.equal(calls[0].opts.stdio, 'inherit');
  assert.equal(calls[0].opts.env[OP_RUN_ACTIVE_ENV], '1', 'child carries the recursion sentinel');
});

test('maybeReExecUnderOpRun does not re-exec when the sentinel is already set', () => {
  const calls = [];
  const res = maybeReExecUnderOpRun({
    env: { [OP_RUN_ACTIVE_ENV]: '1', CONSTRUCT_OP_ENV_FILE: '/tmp/whatever' },
    hasOp: () => true,
    spawnFn: () => { calls.push(1); return { status: 0 }; },
  });
  assert.equal(res.reExecuted, false);
  assert.equal(res.reason, 'already-active');
  assert.equal(calls.length, 0, 'no op run spawned when already active');
});

test('maybeReExecUnderOpRun does not re-exec when not opted in', () => {
  const calls = [];
  const res = maybeReExecUnderOpRun({
    env: {},
    hasOp: () => true,
    spawnFn: () => { calls.push(1); return { status: 0 }; },
  });
  assert.equal(res.reExecuted, false);
  assert.equal(res.reason, 'not-opted-in');
  assert.equal(calls.length, 0);
});

test('maybeReExecUnderOpRun does not re-exec when op is absent (never forces 1Password)', (t) => {
  const { dir, file } = tmpEnvFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const res = maybeReExecUnderOpRun({
    env: { CONSTRUCT_OP_ENV_FILE: file },
    homeDir: dir,
    hasOp: () => false,
    spawnFn: () => { calls.push(1); return { status: 0 }; },
  });
  assert.equal(res.reExecuted, false);
  assert.equal(res.reason, 'op-missing');
  assert.equal(calls.length, 0);
});

test('maybeReExecUnderOpRun falls through on a spawn error so the normal launch still runs', (t) => {
  const { dir, file } = tmpEnvFile();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = maybeReExecUnderOpRun({
    argv: ['/usr/bin/node', '/opt/construct/bin/construct', 'dev'],
    execPath: '/usr/bin/node',
    env: { CONSTRUCT_OP_ENV_FILE: file },
    homeDir: dir,
    hasOp: () => true,
    spawnFn: () => ({ error: new Error('ENOENT') }),
  });
  assert.equal(res.reExecuted, false);
  assert.equal(res.reason, 'spawn-failed');
});
