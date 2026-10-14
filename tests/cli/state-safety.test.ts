import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inProject } from './support.ts';
import type { CliContext } from '../../src/cli/context.ts';
const launcher = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));
function cli(ctx: CliContext, args: string[], env = ctx.env) {
  const r = spawnSync(process.execPath, [launcher, ...args], { cwd: ctx.cwd, env, encoding: 'utf8', timeout: 20000 });
  assert.ifError(r.error);
  return { code: r.status, out: r.stdout, err: r.stderr };
}
test('reset refuses unavailable inspection with a live holder; force is explicit', async () => {
  await inProject(async (ctx, box) => {
    const path = join(box.cwd, '.construct/state/construct.sqlite');
    const holder = spawn(process.execPath, ['--input-type=module', '-e', "import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync(process.argv[1]);console.log('open');process.stdin.resume();process.stdin.on('end',()=>{db.close();process.exit(0)});", path], { env: ctx.env });
    await new Promise<void>((resolve, reject) => { holder.stdout.once('data', () => resolve()); holder.once('error', reject); });
    try {
      const env = { ...ctx.env, PATH: join(box.home, 'missing-tools') };
      const refused = cli(ctx, ['reset', '--confirm', '--keep-state'], env);
      assert.equal(refused.code, 1, refused.err);
      assert.match(refused.err, /cannot inspect.*state database/i);
      assert.equal(holder.exitCode, null);
      assert.ok(existsSync(path));
      const forced = cli(ctx, ['reset', '--confirm', '--keep-state', '--force'], env);
      assert.equal(forced.code, 0, forced.err);
      assert.equal(existsSync(path), false);
    } finally { holder.stdin.end(); await new Promise<void>((resolve) => holder.once('close', () => resolve())); }
  });
});
test('skill impact refuses missing state without recreating it', async () => {
  await inProject((ctx, box) => {
    const path = join(box.cwd, '.construct/state/construct.sqlite');
    rmSync(path);
    const result = cli(ctx, ['skill', 'impact', '--json']);
    assert.equal(result.code, 1);
    assert.match(result.err, /no state database/);
    assert.equal(existsSync(path), false);
  });
});
test('skill impact is byte-preserving and refuses another project identity', async () => {
  await inProject((ctx, box) => {
    const path = join(box.cwd, '.construct/state/construct.sqlite');
    const before = readFileSync(path);
    const result = cli(ctx, ['skill', 'impact', '--json']);
    assert.equal(result.code, 0, result.err);
    assert.deepEqual(JSON.parse(result.out), []);
    assert.deepEqual(readFileSync(path), before);
    const config = join(box.cwd, '.construct/project.json');
    const value = JSON.parse(readFileSync(config, 'utf8'));
    value.id = 'different-project';
    writeFileSync(config, JSON.stringify(value));
    const foreign = cli(ctx, ['skill', 'impact', '--json']);
    assert.equal(foreign.code, 1);
    assert.match(foreign.err, /belongs to project/);
    assert.deepEqual(readFileSync(path), before);
  });
});

test('reset distinguishes an inspected empty result from diagnostics or invalid holder output', async () => {
  for (const probe of [
    { body: "process.exit(1)", refused: false },
    { body: "process.stderr.write('inspection denied');process.exit(1)", refused: true },
    { body: "process.stdout.write('not-a-pid');process.exit(0)", refused: true },
    { body: "process.exit(2)", refused: true },
  ]) {
    await inProject((ctx, box) => {
      const bin = join(box.home, 'holder-probe');
      mkdirSync(bin);
      writeFileSync(join(bin, 'lsof'), `#!${process.execPath}\n${probe.body}\n`, { mode: 0o700 });
      const path = join(box.cwd, '.construct/state/construct.sqlite');
      const before = readFileSync(path);
      const result = cli(ctx, ['reset', '--confirm', '--keep-state'], { ...ctx.env, PATH: bin });
      assert.equal(result.code, probe.refused ? 1 : 0, result.err);
      if (probe.refused) {
        assert.match(result.err, /cannot inspect/);
        assert.deepEqual(readFileSync(path), before);
      } else assert.equal(existsSync(path), false);
    });
  }
});
