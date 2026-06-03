/**
 * tests/hook-output-mode.test.mjs — SessionStart output-mode resolver + router.
 *
 * Pins the precedence (env > config > default `auto`), that `auto` keeps stdout
 * for interactive sessions and goes silent only on reliable non-interactive
 * signals (CI / NODE_ENV=test / CONSTRUCT_NONINTERACTIVE), that an explicit mode
 * overrides auto, and that the router sends the payload to the right channel —
 * `silent` writing a debug log instead of stdout/stderr. These guard the
 * non-interactive output-contract behavior without depending on a live session.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveHookOutputMode, writeHookContext, isNonInteractive } from '../lib/hooks/_lib/output-mode.mjs';

const NULL_CONFIG = null;

test('auto resolves to stdout for an interactive session', () => {
  const r = resolveHookOutputMode({ env: {}, config: NULL_CONFIG });
  assert.equal(r.mode, 'stdout');
  assert.equal(r.requested, 'auto');
  assert.equal(r.nonInteractive, false);
});

test('auto resolves to silent on reliable non-interactive signals', () => {
  for (const env of [{ CI: 'true' }, { NODE_ENV: 'test' }, { CONSTRUCT_NONINTERACTIVE: '1' }]) {
    const r = resolveHookOutputMode({ env, config: NULL_CONFIG });
    assert.equal(r.mode, 'silent', `env ${JSON.stringify(env)} → silent`);
    assert.equal(r.nonInteractive, true);
  }
});

test('CONSTRUCT_NONINTERACTIVE=0/false is not treated as non-interactive', () => {
  assert.equal(isNonInteractive({ CONSTRUCT_NONINTERACTIVE: '0' }), false);
  assert.equal(isNonInteractive({ CONSTRUCT_NONINTERACTIVE: 'false' }), false);
  assert.equal(isNonInteractive({ CONSTRUCT_NONINTERACTIVE: '1' }), true);
});

test('explicit env mode overrides auto even under a non-interactive signal', () => {
  const r = resolveHookOutputMode({ env: { CI: 'true', CONSTRUCT_HOOK_OUTPUT_MODE: 'stdout' }, config: NULL_CONFIG });
  assert.equal(r.mode, 'stdout');
  assert.equal(r.requested, 'stdout');
  assert.equal(r.source, 'env');
});

test('env beats config; config beats default', () => {
  const config = { hooks: { outputMode: 'stderr' } };
  assert.equal(resolveHookOutputMode({ env: {}, config }).mode, 'stderr');
  assert.equal(resolveHookOutputMode({ env: { CONSTRUCT_HOOK_OUTPUT_MODE: 'silent' }, config }).mode, 'silent');
});

test('an invalid mode value falls back to auto', () => {
  const r = resolveHookOutputMode({ env: { CONSTRUCT_HOOK_OUTPUT_MODE: 'bogus' }, config: NULL_CONFIG });
  assert.equal(r.requested, 'auto');
  assert.equal(r.mode, 'stdout');
});

test('writeHookContext routes to stdout/stderr via injected sinks', () => {
  let out = ''; let err = '';
  const stdout = { write: (s) => { out += s; } };
  const stderr = { write: (s) => { err += s; } };
  assert.equal(writeHookContext({ payload: 'CTX', mode: 'stdout', stdout, stderr }), 'stdout');
  assert.equal(out, 'CTX');
  assert.equal(err, '');
  out = '';
  assert.equal(writeHookContext({ payload: 'CTX', mode: 'stderr', stdout, stderr }), 'stderr');
  assert.equal(err, 'CTX');
  assert.equal(out, '');
});

test('silent writes a debug log and touches neither stdout nor stderr', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-hookout-'));
  let out = ''; let err = '';
  const used = writeHookContext({
    payload: 'SUPPRESSED-CONTEXT',
    mode: 'silent',
    homeDir: home,
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  assert.equal(used, 'silent');
  assert.equal(out, '');
  assert.equal(err, '');
  const log = fs.readFileSync(path.join(home, '.cx', 'session-start-last.log'), 'utf8');
  assert.equal(log, 'SUPPRESSED-CONTEXT');
  fs.rmSync(home, { recursive: true, force: true });
});
