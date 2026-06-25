/**
 * tests/functional/chat-surface.functional.test.mjs — construct chat surface routing.
 *
 * Asserts GUI sessions default to the desktop cockpit, with a linear opt-in (browser chat retired).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChatSurface, wantsLinearSurface } from '../../lib/chat/cli.mjs';
import { GUI_TEST_ENV } from './_lib/gui-env.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const tty = { isTTY: true };
const pipe = { isTTY: false };

test('wantsLinearSurface is false on interactive TTY without overrides', () => {
  assert.equal(wantsLinearSurface({
    flags: { plain: false, accessible: false, web: false, window: false, noWindow: false },
    env: {},
    output: tty,
    input: tty,
  }), false);
});

test('wantsLinearSurface is true for plain, accessible, and piped IO', () => {
  const base = { env: {}, output: tty, input: tty };
  assert.equal(wantsLinearSurface({ ...base, flags: { plain: true, accessible: false, web: false, window: false, noWindow: false } }), true);
  assert.equal(wantsLinearSurface({ ...base, flags: { plain: false, accessible: true, web: false, window: false, noWindow: false } }), true);
  assert.equal(wantsLinearSurface({
    flags: { plain: false, accessible: false, web: false, window: false, noWindow: false },
    env: {},
    output: pipe,
    input: pipe,
  }), true);
});

test('resolveChatSurface defaults to desktop on GUI TTY', () => {
  assert.equal(resolveChatSurface({
    flags: { plain: false, accessible: false, web: false, window: false, noWindow: false },
    env: { ...GUI_TEST_ENV },
    output: tty,
    input: tty,
  }), 'desktop');
});

test('resolveChatSurface routes --no-window to linear (browser chat retired)', () => {
  assert.equal(resolveChatSurface({
    flags: { plain: false, accessible: false, window: false, noWindow: true },
    env: { ...GUI_TEST_ENV, CONSTRUCT_CHAT_WINDOW: '1' },
    output: tty,
    input: tty,
  }), 'linear');
});

test('resolveChatSurface routes non-TTY to linear', () => {
  assert.equal(resolveChatSurface({
    flags: { plain: false, accessible: false, web: false, window: false, noWindow: false },
    env: {},
    output: pipe,
    input: pipe,
  }), 'linear');
});

test('construct chat --list smoke test', async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/construct', 'chat', '--list'], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Owned loop/);
  assert.doesNotMatch(result.stderr, /desktop window is not installed/i);
});

// Bare-invoke entry: `stdio: ['ignore', ...]` gives the child an immediately-closed
// stdin, so the linear chat loop reaches EOF and exits cleanly. The kill-guard
// keeps a hung loop from wedging CI.
function runBin(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/construct', ...argv], {
      cwd: REPO_ROOT,
      env: { ...process.env, CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const guard = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => { clearTimeout(guard); reject(err); });
    child.on('close', (code) => { clearTimeout(guard); resolve({ code, stdout, stderr }); });
  });
}

test('bare construct launches the chat session (no subcommand)', async () => {
  const result = await runBin([]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\/help for commands/);
  assert.doesNotMatch(result.stdout, /Run 'construct --help' for available commands/);
  assert.doesNotMatch(result.stderr, /construct chat is deprecated/);
});

test('construct chat alias prints a deprecation notice and still launches', async () => {
  const result = await runBin(['chat']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /construct chat is deprecated/);
  assert.match(result.stdout, /\/help for commands/);
});
