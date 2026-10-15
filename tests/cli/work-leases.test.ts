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
import { chmodSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import { capture, inProject } from './support.ts';
import { withProject } from '../../src/cli/context.ts';
import { claimWork, createWork, handoffWork } from '../../src/kernel/work/service.ts';

test('CLI acceptance retains a private capability before dispatch and recovers lost stdout with the same command', async () => {
  await inProject(async (ctx) => {
    const person = { ...ctx, terminal: { interactive: true, agentAncestor: null } };
    withProject(ctx, project => {
      const at = ctx.now();
      createWork(project.store, { id: 'recoverable', kind: 'task', title: 'Recoverable', description: 'Recoverable', at });
      const a = claimWork(project.store, { id: 'recoverable', owner: 'offerer', paths: ['docs/'], now: at, until: new Date(Date.parse(at) + 30 * 60_000).toISOString() });
      handoffWork(project.store, { id: 'recoverable', owner: 'offerer', token: a.claimToken, packet: { state: 'Ready', next: 'Review' }, now: at });
    });
    const lost = await capture(() => run(['work', 'accept', 'recoverable', '--json'], person));
    assert.equal(lost.code, 0, lost.err);
    const retry = await capture(() => run(['work', 'accept', 'recoverable', '--json'], person));
    assert.equal(retry.code, 0, retry.err);
    const accepted = last(lost.out) as { claimToken: string; claimUntil: string; revision: number };
    const recovered = last(retry.out) as typeof accepted;
    assert.equal(recovered.claimToken, accepted.claimToken);
    assert.equal(recovered.claimUntil, accepted.claimUntil);
    assert.equal(recovered.revision, accepted.revision);
    const directory = join(ctx.paths.stateDir, 'handoff-acceptance');
    assert.equal(statSync(directory).mode & 0o077, 0);
    const files = readdirSync(directory);
    assert.equal(files.length, 1);
    const retained = readFileSync(join(directory, files[0]!), 'utf8');
    assert.equal(retained.length, 64);
    assert.equal(statSync(join(directory, files[0]!)).mode & 0o077, 0);
    assert.ok(!lost.out.includes(retained));
    const snapshot = await capture(() => run(['work', 'export', '--json'], person));
    assert.ok(!snapshot.out.includes(retained));
    assert.ok(!snapshot.out.includes(accepted.claimToken));
    const file = join(directory, files[0]!);
    chmodSync(file, 0o644);
    const publicFile = await capture(() => run(['work', 'accept', 'recoverable', '--json'], person));
    assert.equal(publicFile.code, 1);
    assert.match(publicFile.err, /private regular file/);
    assert.ok(!publicFile.err.includes(retained));
    chmodSync(file, 0o600);
    if (process.platform !== 'win32') {
      const target = join(directory, 'untrusted-target');
      writeFileSync(target, 'not a capability', { mode: 0o600 });
      rmSync(file); symlinkSync(target, file);
      const symbolic = await capture(() => run(['work', 'accept', 'recoverable', '--json'], person));
      assert.equal(symbolic.code, 1);
      assert.ok(!symbolic.err.includes(retained));
      rmSync(file);
      const fifo = spawnSync('mkfifo', [file], { env: { ...ctx.env, PATH: process.env.PATH }, encoding: 'utf8' });
      assert.equal(fifo.status, 0, fifo.stderr);
      const source = `import { run } from ${JSON.stringify(new URL('../../src/cli/index.ts', import.meta.url).href)}; import { createContext } from ${JSON.stringify(new URL('../../src/cli/context.ts', import.meta.url).href)}; const ctx = { ...createContext(), terminal: { interactive: true, agentAncestor: null } }; process.exitCode = await run(['work', 'accept', 'recoverable', '--json'], ctx);`;
      const refused = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: ctx.cwd, env: ctx.env, encoding: 'utf8', timeout: 3000 });
      assert.equal(refused.status, 1, 'a corrupt FIFO receipt refuses promptly instead of blocking its open');
      assert.match(refused.stderr, /private regular file/);
      assert.ok(!refused.stderr.includes(retained));
    }
  });
});

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

    const notMine = await capture(() => run(['work', 'check', '--staged', `--work=${id}`, '--json'], relayed));
    assert.equal(notMine.code, 1, 'a relay cannot hide the person’s reservation by naming it');
    const mine = await capture(() => run(['work', 'check', '--staged', `--work=${id}`, '--json'], person));
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

test('CLI claims and checks refuse symbolic aliases without creating reservations', async () => {
  const { symlinkSync } = await import('node:fs');
  await inProject(async (ctx, box) => {
    const person = { ...ctx, terminal: { interactive: true, agentAncestor: null } };
    symlinkSync(join(box.cwd, 'docs'), join(box.cwd, 'alias'), 'dir');
    const checked = await capture(() => run(['work', 'check', '--paths=alias/new.md', '--json'], ctx));
    assert.notEqual(checked.code, 0);
    assert.match(checked.err, /symbolic link|canonical/i);
    const added = await capture(() => run(['work', 'add', 'edit alias', '--json'], person));
    const id = (last(added.out) as { id: string }).id;
    const claimed = await capture(() => run(['work', 'claim', id, '--paths=alias/new.md', '--json'], person));
    assert.notEqual(claimed.code, 0);
    assert.match(claimed.err, /symbolic link|canonical/i);
    const shown = await capture(() => run(['work', 'show', id, '--json'], person));
    assert.equal((last(shown.out) as { status: string }).status, 'open');
  });
});
