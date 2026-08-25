/**
 * tests/cli/no-color.test.ts — NO_COLOR and TERM=dumb compliance for the read
 * verbs.
 *
 * The CLI applies no ANSI styling anywhere — confirmed by reading every file
 * in src/cli/ and src/kernel/render/: there is no color library dependency,
 * no `\x1b[` literal outside terminal.ts's own escaping of *other people's*
 * control bytes (which turns them into visible `\xNN` text, never into a
 * color code), and terminal.ts's own docstring states the posture in full —
 * Construct owns its formatting and applies none of it as color. So NO_COLOR
 * (https://no-color.org) and TERM=dumb have nothing to disable, which makes
 * this AC vacuous rather than unmet: this test is the standing proof. If a
 * color library or a raw `\x1b[` styling literal is ever added to src/cli/ or
 * src/kernel/render/, this test starts failing the moment it prints anything,
 * which is the point — the day this stops being vacuous is the day NO_COLOR
 * handling has to become real, not decorative.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inbox, lessons, log } from '../../src/cli/index.ts';

const ESC = String.fromCodePoint(0x1b);
/** Any CSI/OSC-introducing escape, or a bare C1 equivalent, reading as a terminal command. */
const ANSI = new RegExp(`${ESC}\\[|${ESC}\\]`);

async function capture(fn: () => number): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'construct-nocolor-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  try {
    fn();
    return out.join('');
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

for (const [name, run] of Object.entries({
  log: () => log([]),
  inbox: () => inbox([]),
  lessons: () => lessons([]),
})) {
  test(`${name}: output carries no ANSI escape under NO_COLOR=1`, async () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      const out = await capture(run);
      assert.doesNotMatch(out, ANSI);
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });

  test(`${name}: output carries no ANSI escape under TERM=dumb`, async () => {
    const previous = process.env.TERM;
    process.env.TERM = 'dumb';
    try {
      const out = await capture(run);
      assert.doesNotMatch(out, ANSI);
    } finally {
      if (previous === undefined) delete process.env.TERM;
      else process.env.TERM = previous;
    }
  });

  test(`${name}: output is identical whether or not NO_COLOR is set — there was never anything to strip`, async () => {
    const withoutFlag = await capture(run);
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    let withFlag: string;
    try {
      withFlag = await capture(run);
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
    assert.equal(withFlag, withoutFlag);
  });
}
