/**
 * tests/cli/completions.test.ts — completion scripts derive from the command
 * registry, so every command is completable and nothing else is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { COMMANDS, run } from '../../src/cli/index.ts';
import { completionScript } from '../../src/cli/completions.ts';
import { capture } from './support.ts';

const nouns = [...new Set(COMMANDS.map((c) => c.path[0]))];

test('the registry names no removed verb', () => {
  for (const gone of ['outcome', 'work', 'ask', 'skills', 'settings', 'serve']) assert.ok(!nouns.includes(gone), gone);
});

test('bash and zsh scripts name every command noun and subcommand', () => {
  for (const shell of ['bash', 'zsh', 'fish'] as const) {
    const script = completionScript(shell, COMMANDS);
    for (const noun of nouns) assert.ok(script.includes(noun), `${shell} names ${noun}`);
    for (const c of COMMANDS) if (c.path[1]) assert.ok(script.includes(c.path[1]), `${shell} names ${c.path.join(' ')}`);
  }
});

test('the bash script parses under bash and the zsh script under zsh where available', () => {
  execFileSync('bash', ['-n'], { input: completionScript('bash', COMMANDS) });
  try {
    execFileSync('zsh', ['-n'], { input: completionScript('zsh', COMMANDS) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
});

test('construct completion prints bash by default, honors --shell, and refuses an unknown shell', async () => {
  const bash = await capture(() => run(['completion']));
  assert.equal(bash.code, 0);
  assert.match(bash.out, /complete -F _construct construct/);
  const fish = await capture(() => run(['completion', '--shell=fish']));
  assert.equal(fish.code, 0);
  assert.match(fish.out, /complete -c construct/);
  const bad = await capture(() => run(['completion', '--shell=powershell']));
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--shell must be one of/);
});
