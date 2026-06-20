/**
 * tests/functional/chat-surface.functional.test.mjs — construct chat surface routing.
 *
 * Asserts GUI sessions default to the desktop cockpit, with web and linear opt-ins.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveChatSurface, wantsLinearSurface } from '../../lib/chat/cli.mjs';

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
    env: {},
    output: tty,
    input: tty,
  }), 'desktop');
});

test('resolveChatSurface uses web for --web and --no-window', () => {
  assert.equal(resolveChatSurface({
    flags: { plain: false, accessible: false, web: true, window: false, noWindow: false },
    env: {},
    output: tty,
    input: tty,
  }), 'web');

  assert.equal(resolveChatSurface({
    flags: { plain: false, accessible: false, web: false, window: false, noWindow: true },
    env: { CONSTRUCT_CHAT_WINDOW: '1' },
    output: tty,
    input: tty,
  }), 'web');
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
