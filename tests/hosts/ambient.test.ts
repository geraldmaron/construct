/**
 * tests/hosts/ambient.test.ts — which host, if any, a fabricated environment
 * says this process is running inside. Every case hands `detectAmbientHost`
 * its own env object rather than touching `process.env`, so nothing here
 * depends on what actually launched the test runner (itself very likely a
 * detected host).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMBIENT_ENV_KEYS, detectAmbientHost } from '../../src/hosts/ambient.ts';

test('CLAUDECODE=1 is detected as claude', () => {
  const detection = detectAmbientHost({ CLAUDECODE: '1' });
  assert.deepEqual(detection, { host: 'claude', marker: 'CLAUDECODE' });
});

test('CLAUDE_CODE_ENTRYPOINT alone is detected as claude', () => {
  const detection = detectAmbientHost({ CLAUDE_CODE_ENTRYPOINT: 'cli' });
  assert.deepEqual(detection, { host: 'claude', marker: 'CLAUDE_CODE_ENTRYPOINT' });
});

test('CURSOR_AGENT is detected as cursor', () => {
  const detection = detectAmbientHost({ CURSOR_AGENT: '1' });
  assert.deepEqual(detection, { host: 'cursor', marker: 'CURSOR_AGENT' });
});

test('CURSOR_CLI is detected as cursor', () => {
  const detection = detectAmbientHost({ CURSOR_CLI: '1' });
  assert.deepEqual(detection, { host: 'cursor', marker: 'CURSOR_CLI' });
});

test('BOB_SHELL_CLI_IDE_SERVER_PORT is detected as bob, a host with no wired adapter', () => {
  const detection = detectAmbientHost({ BOB_SHELL_CLI_IDE_SERVER_PORT: '42991' });
  assert.deepEqual(detection, { host: 'bob', marker: 'BOB_SHELL_CLI_IDE_SERVER_PORT' });
});

test('a clean environment detects nothing — the regression case', () => {
  assert.equal(detectAmbientHost({}), null);
});

test('an environment with none of the recognized keys detects nothing', () => {
  assert.equal(detectAmbientHost({ PATH: '/usr/bin', HOME: '/home/x', TERM_PROGRAM: 'vscode' }), null);
});

test('TERM_PROGRAM alone is never read as a positive signal', () => {
  // Verified unreliable: Cursor's own integrated terminal reports
  // TERM_PROGRAM=vscode, identical to plain VS Code, so the value cannot
  // distinguish the host it would claim to name.
  assert.equal(detectAmbientHost({ TERM_PROGRAM: 'cursor' }), null);
});

test('claude is checked before cursor, when a process somehow carries both', () => {
  const detection = detectAmbientHost({ CLAUDECODE: '1', CURSOR_AGENT: '1' });
  assert.equal(detection?.host, 'claude');
});

test('AMBIENT_ENV_KEYS names every key a detector reads, for test isolation elsewhere', () => {
  assert.deepEqual(
    [...AMBIENT_ENV_KEYS].sort(),
    ['BOB_SHELL_CLI_IDE_SERVER_PORT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CURSOR_AGENT', 'CURSOR_CLI'].sort(),
  );
});
