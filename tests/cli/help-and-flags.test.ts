/**
 * tests/cli/help-and-flags.test.ts — help is grouped and complete, every
 * command answers --help, an unknown flag or command is refused by name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, HELP_GROUPS, run } from '../../src/cli/index.ts';
import { capture } from './support.ts';

test('construct help lists every command under a group with a gloss, and starts with init', async () => {
  const { code, out } = await capture(() => run(['help']));
  assert.equal(code, 0);
  assert.match(out, /Start here: construct init/);
  for (const c of COMMANDS) {
    assert.ok(out.includes(`  ${c.path.join(' ')}`), `help lists ${c.path.join(' ')}`);
    assert.ok(out.includes(c.gloss), `help glosses ${c.path.join(' ')}`);
    assert.ok(HELP_GROUPS.includes(c.group), `${c.path.join(' ')} sits in a known group`);
  }
  for (const spelling of [[], ['--help'], ['-h']]) {
    const again = await capture(() => run(spelling));
    assert.equal(again.out, out);
  }
});

test('every command answers --help with its usage line and flags, exiting 0 and doing nothing', async () => {
  for (const c of COMMANDS) {
    if (c.path[0] === 'help') continue;
    const { code, out } = await capture(() => run([...c.path, '--help']));
    assert.equal(code, 0, c.path.join(' '));
    assert.match(out, new RegExp(`^construct ${c.path.join(' ')}`));
    for (const f of c.flags) assert.ok(out.includes(`--${f.name}`), `${c.path.join(' ')} --help names --${f.name}`);
    assert.ok(out.includes('--json'), 'global flags are shown');
  }
});

test('an unknown flag is refused by name with the command’s help, exit 2', async () => {
  const { code, err } = await capture(() => run(['status', '--verbose']));
  assert.equal(code, 2);
  assert.match(err, /construct status: unknown flag --verbose/);
  assert.match(err, /^construct status/m);
});

test('an unknown command is refused by name and still shows the grouped help, exit 2', async () => {
  const { code, out, err } = await capture(() => run(['outcome', 'ship it']));
  assert.equal(code, 2);
  assert.match(err, /unknown command "outcome"/);
  assert.match(out, /Start here: construct init/);
});

test('a noun without its subcommand names the subcommands, exit 2', async () => {
  const bare = await capture(() => run(['source']));
  assert.equal(bare.code, 2);
  assert.match(bare.err, /needs a subcommand: add \| list \| refresh \| relate \| retire \| show|needs a subcommand: list \| show \| add \| retire \| refresh \| relate/);
  const wrong = await capture(() => run(['source', 'watch']));
  assert.equal(wrong.code, 2);
  assert.match(wrong.err, /no subcommand "watch"/);
});

test('a value flag without a value is refused, exit 2', async () => {
  const { code, err } = await capture(() => run(['completion', '--shell']));
  assert.equal(code, 2);
  assert.match(err, /--shell needs a value/);
});

test('--version and version print the package version', async () => {
  const a = await capture(() => run(['--version']));
  const b = await capture(() => run(['version']));
  assert.equal(a.code, 0);
  assert.match(a.out, /^\d+\.\d+\.\d+/);
  assert.equal(a.out, b.out);
});
