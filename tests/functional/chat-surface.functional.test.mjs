/**
 * tests/functional/chat-surface.functional.test.mjs — terminal-only chat entry.
 *
 * The desktop window and browser cockpit were retired with lib/server
 * (construct-m7k2-web-deprecation), so chat is terminal-only. Asserts bare
 * `construct` launches the linear renderer, the deprecated `chat` alias still
 * works, and the retired `--window` flag no-ops to the terminal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUI_TEST_ENV } from './_lib/gui-env.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// `stdio: ['ignore', ...]` gives the child an immediately-closed stdin, so the
// linear chat loop reaches EOF and exits cleanly. The kill-guard keeps a hung
// loop from wedging CI.
function runBin(argv, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/construct', ...argv], {
      cwd: REPO_ROOT,
      env: { ...process.env, CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1', ...extraEnv },
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

test('construct chat --list smoke test', async () => {
  const result = await runBin(['chat', '--list']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Owned loop/);
  assert.doesNotMatch(result.stderr, /desktop window is not installed/i);
});

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

test('--window is retired and chat runs in the terminal even with a GUI env', async () => {
  const result = await runBin(['--window'], { ...GUI_TEST_ENV, CONSTRUCT_CHAT_WINDOW: '1' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /retired/);
  assert.match(result.stdout, /\/help for commands/);
  assert.doesNotMatch(result.stderr, /No graphical display|Desktop chat unavailable/);
});
