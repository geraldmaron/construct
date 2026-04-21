/**
 * tests/session-start-hook.test.mjs — Integration test for the session-start hook.
 *
 * Spawns lib/hooks/session-start.mjs as a child process with a temporary .cx/context.json
 * and verifies it exits 0 and emits a "Resuming" context block to stdout.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

test('session-start hook remains non-blocking and emits resume context', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-session-start-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cx', 'context.json'), `${JSON.stringify({ format: 'json', savedAt: new Date().toISOString(), markdown: '# Session Context\n' }, null, 2)}\n`);

  const result = spawnSync('node', [path.join(repoRoot, 'lib', 'hooks', 'session-start.mjs')], {
    cwd,
    input: JSON.stringify({ cwd }),
    encoding: 'utf8',
    timeout: 15000,
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Resuming/);
});
