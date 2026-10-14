import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { inProject } from './support.ts';
import type { CliContext } from '../../src/cli/context.ts';

const launcher = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));
const observer = fileURLToPath(new URL('../harness/source-read-observer.mjs', import.meta.url));
const add = (id: string) => ['source', 'add', id, '--kind=directory', '--purpose=project docs', '--locator=.', '--json'];
function cli(ctx: CliContext, args: string[]) {
  const result = spawnSync(process.execPath, [launcher, ...args], { cwd: ctx.cwd, env: ctx.env, encoding: 'utf8', timeout: 20000 });
  if (result.error) throw result.error;
  return { code: result.status, out: result.stdout, err: result.stderr };
}
function json(ctx: CliContext, args: string[]) {
  const result = cli(ctx, args);
  assert.equal(result.code, 0, result.err);
  return JSON.parse(result.out);
}

test('concurrent source additions reread declarations under the shared write lock', async () => {
  await inProject(async (ctx, box) => {
    const db = new DatabaseSync(join(box.cwd, '.construct/state/construct.sqlite'));
    db.exec('BEGIN IMMEDIATE');
    const children = ['alpha', 'beta'].map(id => {
      const child = fork(observer, add(id), { cwd: box.cwd, execArgv: [], env: { ...ctx.env, CONSTRUCT_AUDIT_LAUNCHER: launcher }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let err = '';
      child.stderr!.on('data', bytes => err += String(bytes));
      return { child,
        read: new Promise<{ ids: string[] }>((resolve, reject) => { child.once('message', value => resolve(value as { ids: string[] })); child.once('error', reject); }),
        done: new Promise<{ code: number | null; err: string }>(resolve => child.once('exit', code => resolve({ code, err }))) };
    });
    const timer = setTimeout(() => { for (const { child } of children) child.kill('SIGKILL'); }, 15000);
    try {
      const loaded = await Promise.all(children.map(child => child.read));
      assert.deepEqual(loaded.map(row => row.ids), [[], []], 'both bound the same stale declaration snapshot');
      db.exec('COMMIT');
      for (const result of await Promise.all(children.map(child => child.done))) assert.equal(result.code, 0, result.err);
      assert.deepEqual(JSON.parse(readFileSync(join(box.cwd, '.construct/sources.json'), 'utf8')).sources.map((s: { id: string }) => s.id).sort(), ['alpha', 'beta']);
      assert.deepEqual(db.prepare('SELECT id,status FROM sources ORDER BY id').all().map(row => ({ ...row })), [{ id: 'alpha', status: 'active' }, { id: 'beta', status: 'active' }]);
    } finally { clearTimeout(timer); for (const { child } of children) child.kill(); db.close(); }
  });
});

test('multiple stranded retired declarations can be removed individually without losing history', async () => {
  await inProject(async (ctx, box) => {
    const file = join(box.cwd, '.construct/sources.json');
    const retired = [];
    for (const id of ['old', 'other']) {
      json(ctx, add(id));
      retired.push(JSON.parse(readFileSync(file, 'utf8')).sources[0]);
      json(ctx, ['source', 'retire', id, '--json']);
    }
    const declaration = JSON.parse(readFileSync(file, 'utf8'));
    declaration.sources = retired;
    writeFileSync(file, JSON.stringify(declaration));
    const first = json(ctx, ['source', 'retire', 'old', '--json']);
    assert.deepEqual(first.remainingRetired, ['other']);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).sources.map((s: { id: string }) => s.id), ['other']);
    json(ctx, ['source', 'retire', 'other', '--json']);
    json(ctx, add('new'));
    assert.deepEqual(json(ctx, ['source', 'list', '--json']).map((row: { source: { id: string } }) => row.source.id), ['new']);
  });
});

test('retirement succeeds even when unrelated declarations cannot reconcile', async () => {
  await inProject(async (ctx, box) => {
    json(ctx, add('old')); json(ctx, add('docs'));
    const file = join(box.cwd, '.construct/sources.json');
    const declarations = JSON.parse(readFileSync(file, 'utf8'));
    declarations.sources.find((s: { id: string }) => s.id === 'docs').kind = 'jira';
    declarations.sources.find((s: { id: string }) => s.id === 'docs').locator = 'PROJ';
    writeFileSync(file, JSON.stringify(declarations));
    const retired = json(ctx, ['source', 'retire', 'old', '--json']);
    assert.match(retired.reconciliationError, /directory source/);
    assert.equal(json(ctx, ['source', 'show', 'docs', '--json']).source.kind, 'directory');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).sources.map((s: { id: string }) => s.id), ['docs']);
  });
});

test('kind changes fail through init and repeated CLI refreshes keep claims bounded', async () => {
  await inProject(async (ctx, box) => {
    json(ctx, add('docs'));
    const db = new DatabaseSync(join(box.cwd, '.construct/state/construct.sqlite'), { readOnly: true });
    try {
      let claims = 0;
      for (let i = 0; i < 3; i++) {
        const read = json(ctx, ['source', 'refresh', 'docs', '--json']);
        assert.equal(read.outcome, i === 0 ? 'changed' : 'unchanged');
        const count = db.prepare('SELECT COUNT(*) AS n FROM claims WHERE source_id=?').get('docs')!.n;
        if (i === 0) claims = Number(count);
        assert.equal(Number(count), claims);
      }
      const file = join(box.cwd, '.construct/sources.json');
      const declarations = JSON.parse(readFileSync(file, 'utf8'));
      declarations.sources[0].kind = 'jira'; declarations.sources[0].locator = 'PROJ';
      writeFileSync(file, JSON.stringify(declarations));
      const init = cli(ctx, ['init', '--no-wire', '--json']);
      assert.equal(init.code, 1);
      assert.match(init.err, /directory source/);
      const source = json(ctx, ['source', 'show', 'docs', '--json']);
      assert.equal(source.source.kind, 'directory'); assert.equal(source.source.locator, box.cwd);
    } finally { db.close(); }
  });
});


test('init reconciles declarations committed after its initial project-file snapshot', async () => {
  await inProject(async (ctx, box) => {
    const gate = join(box.home, 'release-init');
    const child = fork(observer, ['init', '--no-wire', '--json'], { cwd: box.cwd, execArgv: [], env: { ...ctx.env, CONSTRUCT_AUDIT_LAUNCHER: launcher, CONSTRUCT_SOURCE_READ_GATE: gate }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let err = '';
    child.stderr!.on('data', bytes => err += String(bytes));
    const done = new Promise<number | null>(resolve => child.once('exit', resolve));
    const timer = setTimeout(() => child.kill('SIGKILL'), 18000);
    try {
      const loaded = await new Promise<{ ids: string[] }>((resolve, reject) => { child.once('message', value => resolve(value as { ids: string[] })); child.once('error', reject); });
      assert.deepEqual(loaded.ids, []);
      json(ctx, add('added-after-init-read'));
      writeFileSync(gate, 'continue');
      assert.equal(await done, 0, err);
      assert.deepEqual(json(ctx, ['source', 'list', '--json']).map((row: { source: { id: string } }) => row.source.id), ['added-after-init-read']);
    } finally { clearTimeout(timer); child.kill(); }
  });
});


test('init repairs declaration changes if a process dies after file replacement before database commit', async () => {
  await inProject(async (ctx, box) => {
    const file = join(box.cwd, '.construct/sources.json');
    const db = new DatabaseSync(join(box.cwd, '.construct/state/construct.sqlite'), { readOnly: true });
    const crash = async (args: string[]) => {
      const child = fork(observer, args, { cwd: box.cwd, execArgv: [], env: { ...ctx.env, CONSTRUCT_AUDIT_LAUNCHER: launcher, CONSTRUCT_SOURCE_CRASH_AFTER_REPLACE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      const result = await new Promise<{ code: number | null; signal: string | null }>(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      assert.equal(result.signal, 'SIGKILL');
    };
    try {
      await crash(add('recoverable'));
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).sources.map((s: { id: string }) => s.id), ['recoverable']);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sources').get()!.n, 0, 'uncommitted activation rolled back');
      json(ctx, ['init', '--no-wire', '--json']);
      assert.equal(json(ctx, ['source', 'show', 'recoverable', '--json']).source.status, 'active');
      await crash(['source', 'retire', 'recoverable', '--json']);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).sources, []);
      assert.equal(db.prepare('SELECT status FROM sources WHERE id=?').get('recoverable')!.status, 'active');
      json(ctx, ['init', '--no-wire', '--json']);
      assert.equal(db.prepare('SELECT status FROM sources WHERE id=?').get('recoverable')!.status, 'retired');
    } finally { db.close(); }
  });
});
