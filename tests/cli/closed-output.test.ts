/**
 * tests/cli/closed-output.test.ts — a reader that closes the pipe early ends
 * the command quietly, with no stack trace.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

test('construct help | head -1 ends quietly', async () => {
  const home = mkdtempSync(join(tmpdir(), 'construct-closed-output-'));
  try {
    const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', `"$0" help | head -1`, LAUNCHER], {
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
    });
    assert.match(stdout, /^construct — /);
    assert.doesNotMatch(stderr, /EPIPE|    at /);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
