/**
 * tests/cli/no-color.test.ts — meaning never rides on color: no command emits
 * an ANSI escape, whatever the terminal says.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../src/cli/index.ts';
import { capture, inProject } from './support.ts';

const ESC = String.fromCodePoint(0x1b);
const ANSI = new RegExp(`${ESC}\\[|${ESC}\\]`);

test('help, status, doctor, and config carry no ANSI escape', async () => {
  await inProject(async (ctx) => {
    for (const argv of [['help'], ['status'], ['doctor'], ['config', 'list'], ['project', 'show'], ['source', 'list']]) {
      const { out, err } = await capture(() => run(argv, ctx));
      assert.doesNotMatch(out, ANSI, argv.join(' '));
      assert.doesNotMatch(err, ANSI, argv.join(' '));
    }
  });
});
