import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../../src/cli/index.ts';
import { parseArgs } from '../../src/cli/commands.ts';
import { inProject } from './support.ts';

const launcher = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

test('the entire command registry refuses excess operands, including after --', () => {
  for (const spec of COMMANDS) {
    const operands = spec.positionals.map((_, i) => `operand-${i}`);
    assert.deepEqual(parseArgs(spec, operands).positionals, operands, spec.path.join(' '));
    assert.throws(() => parseArgs(spec, [...operands, 'extra']), /unexpected argument/, spec.path.join(' '));
    assert.throws(() => parseArgs(spec, ['--', ...operands, 'extra']), /unexpected argument/, spec.path.join(' '));
    assert.equal(parseArgs(spec, ['--help']).help, true);
  }
  const hook = COMMANDS.find((spec) => spec.path.join(' ') === 'hook')!;
  assert.deepEqual(parseArgs(hook, ['claude-code']).positionals, ['claude-code']);
  assert.deepEqual(parseArgs(hook, ['claude-code', 'SessionStart']).positionals, ['claude-code', 'SessionStart']);
});

test('actual source add rejects an extra ID before changing declarations or registry', async () => {
  await inProject((_ctx, box) => {
    const file = join(box.cwd, '.construct/sources.json');
    const before = readFileSync(file, 'utf8');
    const result = spawnSync(process.execPath, [launcher, 'source', 'add', 'docs', 'ignored-extra-argument',
      '--kind=directory', '--purpose=docs', '--locator=.', '--json'], { cwd: box.cwd, env: box.ctx.env, encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /unexpected argument.*ignored-extra-argument/);
    assert.equal(readFileSync(file, 'utf8'), before);
    const listed = spawnSync(process.execPath, [launcher, 'source', 'list', '--json'], {
      cwd: box.cwd, env: box.ctx.env, encoding: 'utf8',
    });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), []);
  });
});
