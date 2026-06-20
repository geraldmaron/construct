/**
 * tests/functional/chat-desktop-launcher.functional.test.mjs — desktop window launcher.
 *
 * Uses scripts/mock-construct-chat-desktop.mjs as the construct-chat binary and
 * asserts the dashboard /chat/?surface=desktop URL is passed through.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOCK_BIN = path.join(REPO_ROOT, 'scripts', 'mock-construct-chat-desktop.mjs');

function runNode(args, { env = {}, cwd = REPO_ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('runDesktopChat passes surface=desktop URL to the binary', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-chat-desktop-'));
  const marker = path.join(tmp, 'opened.url');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const mod = await import('../../lib/chat/desktop-launcher.mjs');
  const code = await mod.runDesktopChat({
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CONSTRUCT_CHAT_DESKTOP_BIN: MOCK_BIN,
      CONSTRUCT_CHAT_DESKTOP_MARKER: marker,
      CX_CHAT_NO_DISPLAY: '0',
    },
    output: { write: () => {} },
    errorOutput: { write: () => {} },
    binaryPath: MOCK_BIN,
    dashOverride: { port: 4242, url: 'http://127.0.0.1:4242' },
  });

  assert.equal(code, 0);
  assert.ok(fs.existsSync(marker));
  const url = fs.readFileSync(marker, 'utf8');
  assert.match(url, /\/chat\/\?surface=desktop$/);
});

test('resolveDesktopBinary finds mock binary via CONSTRUCT_CHAT_DESKTOP_BIN', async () => {
  const { resolveDesktopBinary } = await import('../../lib/chat/desktop-binary.mjs');
  const prev = process.env.CONSTRUCT_CHAT_DESKTOP_BIN;
  process.env.CONSTRUCT_CHAT_DESKTOP_BIN = MOCK_BIN;
  try {
    assert.equal(resolveDesktopBinary(), MOCK_BIN);
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_CHAT_DESKTOP_BIN;
    else process.env.CONSTRUCT_CHAT_DESKTOP_BIN = prev;
  }
});

test('runDesktopChat falls back to app window when Tauri binary is missing', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-chat-appwin-'));
  const fakeBrowser = path.join(tmp, 'fake-chrome');
  fs.writeFileSync(fakeBrowser, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const mod = await import('../../lib/chat/desktop-launcher.mjs');
  const code = await mod.runDesktopChat({
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CONSTRUCT_CHAT_DESKTOP_BIN: path.join(tmp, 'missing-construct-chat'),
      CONSTRUCT_CHAT_APP_BROWSER: fakeBrowser,
      CX_CHAT_NO_DISPLAY: '0',
    },
    output: { write: () => {} },
    errorOutput: { write: () => {} },
    dashOverride: { port: 4242, url: 'http://127.0.0.1:4242' },
  });

  assert.equal(code, 0);
});
