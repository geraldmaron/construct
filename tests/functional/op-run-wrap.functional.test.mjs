/**
 * tests/functional/op-run-wrap.functional.test.mjs — opt-in `op run` service wrapping.
 *
 * Asserts the dashboard launch command is wrapped in `op run` only when
 * CONSTRUCT_OP_ENV_FILE points at a real file and the op CLI is present, and is
 * returned untouched otherwise (1Password never forced).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wrapWithOpRun, resolveOpEnvFile } from '../../lib/providers/op-run.mjs';

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
