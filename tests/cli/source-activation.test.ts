import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import { capture, inProject } from './support.ts';

const add = (id: string) => ['source', 'add', id, '--kind=directory', '--purpose=project docs', '--locator=.'];

test('rejected retired IDs leave declarations unchanged and later new sources activate', async () => {
  await inProject(async (ctx, box) => {
    assert.equal((await capture(() => run(add('old'), ctx))).code, 0);
    assert.equal((await capture(() => run(['source', 'retire', 'old'], ctx))).code, 0);
    const file = join(box.cwd, '.construct/sources.json');
    const before = readFileSync(file, 'utf8');
    const rejected = await capture(() => run(add('old'), ctx));
    assert.equal(rejected.code, 1);
    assert.match(rejected.err, /was retired/);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal((await capture(() => run(add('new'), ctx))).code, 0);
    const listed = await capture(() => run(['source', 'list', '--json'], ctx));
    assert.deepEqual(JSON.parse(listed.out).map((r: { source: { id: string } }) => r.source.id), ['new']);
  });
});

test('retiring a stranded declaration recovers new declarations from the earlier failed add', async () => {
  await inProject(async (ctx, box) => {
    assert.equal((await capture(() => run(add('old'), ctx))).code, 0);
    const file = join(box.cwd, '.construct/sources.json');
    const declared = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal((await capture(() => run(['source', 'retire', 'old'], ctx))).code, 0);
    declared.sources.push({ ...declared.sources[0], id: 'new' });
    writeFileSync(file, JSON.stringify(declared));
    const before = readFileSync(file, 'utf8');
    const rejected = await capture(() => run(add('another'), ctx));
    assert.equal(rejected.code, 1);
    assert.equal(readFileSync(file, 'utf8'), before);
    const recovered = await capture(() => run(['source', 'retire', 'old'], ctx));
    assert.equal(recovered.code, 0, recovered.err);
    const listed = await capture(() => run(['source', 'list', '--json'], ctx));
    assert.deepEqual(JSON.parse(listed.out).map((r: { source: { id: string } }) => r.source.id), ['new']);
    assert.equal((await capture(() => run(['source', 'refresh', 'new', '--json'], ctx))).code, 0);
  });
});


test('a declaration write failure rolls back source activation', async () => {
  await inProject(async (ctx, box) => {
    const file = join(box.cwd, '.construct/sources.json');
    const before = readFileSync(file, 'utf8');
    mkdirSync(`${file}.${String(process.pid)}.tmp`);
    const result = await capture(() => run(add('new'), ctx));
    assert.equal(result.code, 1);
    assert.equal(readFileSync(file, 'utf8'), before);
    const listed = await capture(() => run(['source', 'list', '--json'], ctx));
    assert.deepEqual(JSON.parse(listed.out), []);
  });
});
