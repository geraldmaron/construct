/**
 * tests/cli/work-leases.test.ts — reserving paths from the command line, and
 * checking what a commit is about to touch.
 *
 * The person may reserve paths with a claim. `work check` says whether paths
 * are reserved by other work, and with --staged checks exactly the files
 * staged for commit, which is what a pre-commit guard runs. A collision in
 * this checkout exits 1; the caller's own work can be left out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import { capture, inProject } from './support.ts';

const last = (out: string): unknown => JSON.parse(out.trim().split('\n').pop()!);

test('a claim reserves paths, and work check reports the staged files it holds', async () => {
  await inProject(async (ctx, box) => {
    const person = { ...ctx, terminal: { interactive: true, agentAncestor: null } };
    const git = (...args: string[]): void => {
      const r = spawnSync('git', args, { cwd: box.cwd, env: ctx.env, encoding: 'utf8' });
      assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    };
    git('init', '-q', '-b', 'main');
    const added = await capture(() => run(['work', 'add', 'change the parser', '--json'], person));
    const id = (last(added.out) as { id: string }).id;

    const claimed = await capture(() => run(['work', 'claim', id, '--paths=src/parser/, docs/parser.md', '--json'], person));
    assert.equal(claimed.code, 0, claimed.err);
    assert.deepEqual((last(claimed.out) as { leases: { path: string }[] }).leases.map((l) => l.path), ['src/parser/', 'docs/parser.md']);

    const shown = await capture(() => run(['work', 'show', id], person));
    assert.match(shown.out, /reserves \(exclusive\): docs\/parser\.md, src\/parser\//);

    const refused = await capture(() => run(['work', 'claim', id, '--paths=../outside'], person));
    assert.equal(refused.code, 2, 'a path outside the repository is a usage error');
    const spaced = await capture(() => run(['work', 'claim', id, '--paths=docs/my notes.md'], person));
    assert.equal(spaced.code, 2, 'a reserved path is spelled without spaces');
    assert.match(spaced.err, /reserve the directory that holds it/);

    mkdirSync(join(box.cwd, 'src', 'parser'), { recursive: true });
    writeFileSync(join(box.cwd, 'src', 'parser', 'lex.ts'), 'export {};\n');
    writeFileSync(join(box.cwd, 'NOTES.md'), 'notes\n');
    git('add', 'src/parser/lex.ts', 'NOTES.md');

    const relayed = { ...ctx, terminal: { interactive: false, agentAncestor: 'claude' } };
    const staged = await capture(() => run(['work', 'check', '--staged'], relayed));
    assert.equal(staged.code, 1, 'a staged file under another claim’s reservation in this checkout');
    assert.match(staged.out, new RegExp(`reserved here: src/parser/lex\\.ts is under src/parser/, held by person via cli for ${id} until `));
    assert.doesNotMatch(staged.out, /change the parser/, 'another claim’s title is not repeated');
    assert.doesNotMatch(staged.out, /NOTES/);

    const mine = await capture(() => run(['work', 'check', '--staged', `--work=${id}`, '--json'], relayed));
    assert.equal(mine.code, 0, mine.err);
    assert.deepEqual(last(mine.out), { clear: true, collisions: [], mergeRisks: [] });

    const spacedCheck = await capture(() => run(['work', 'check', '--paths=docs/my notes.md'], relayed));
    assert.equal(spacedCheck.code, 0, 'a path only being checked keeps its spelling');
    const clear = await capture(() => run(['work', 'check', '--paths=README.md'], relayed));
    assert.equal(clear.code, 0);
    assert.match(clear.out, /clear: 1 path/);

    const nothing = await capture(() => run(['work', 'check'], relayed));
    assert.equal(nothing.code, 2);
  });
});
