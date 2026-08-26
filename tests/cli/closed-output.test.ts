/**
 * tests/cli/closed-output.test.ts — what the CLI does when its reader leaves.
 *
 * `construct outcome … | head -1` closes the pipe while the command is still
 * writing. Node's default for a write to a closed stdout is an unhandled
 * 'error' event, which surfaces as a crash with a full stack trace — on a
 * pipeline anyone might type. The reader going away is a normal end for a
 * command-line tool, so the assertion is that nothing is reported as wrong.
 *
 * Spawned through a shell rather than driven in-process on purpose: the defect
 * is in the interaction between the process and its pipe, and an in-process
 * call has no pipe to close.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AMBIENT_ENV_KEYS } from '../../src/hosts/ambient.ts';

const execFileAsync = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

test('a reader that closes the pipe early ends the command quietly', async () => {
  const home = mkdtempSync(join(tmpdir(), 'construct-closed-output-'));
  mkdirSync(join(home, '.local', 'share'), { recursive: true });
  try {
    // `head -1` takes the first line and closes: the command is still writing
    // its implicated domains, its work-log summary and its plan at that point.
    // This is the terminal-first keyword path; an ambient marker from the
    // runner would make outcome print a naming packet instead of `run …`.
    const env = { ...process.env };
    for (const key of AMBIENT_ENV_KEYS) delete env[key];
    const { stdout, stderr } = await execFileAsync(
      '/bin/sh',
      [
        '-c',
        `"$0" outcome "We want to hire a contractor in Poland and pay them in euros" | head -1`,
        LAUNCHER,
      ],
      {
        env: {
          ...env,
          HOME: home,
          XDG_STATE_HOME: join(home, '.local', 'state'),
          XDG_DATA_HOME: join(home, '.local', 'share'),
        },
      },
    );

    assert.match(stdout, /^run /, 'the first line should still reach the reader');
    assert.doesNotMatch(
      stderr,
      /EPIPE|Unhandled|throw er/,
      `a closed reader must not be reported as a failure — got: ${stderr}`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
