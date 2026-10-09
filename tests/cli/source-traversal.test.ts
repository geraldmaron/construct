import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { brokerFixture } from '../kernel/broker/support.ts';
import { currentManifest } from '../../src/kernel/source/manifest.ts';

test('installed command traverses real declared source files and preserves omitted older items', async () => {
  const fx = brokerFixture();
  try {
    const command = (args: string[]) => { const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url)), ...args], { cwd: fx.box.cwd, env: fx.ctx.env, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
    const dir = join(fx.box.cwd, 'records'); mkdirSync(dir);
    writeFileSync(join(dir, 'start.md'), '[Policy][p]\n\n[p]: policy.md');
    writeFileSync(join(dir, 'policy.md'), 'The service does not store passwords.');
    writeFileSync(join(dir, 'older.md'), 'Prior evidence not linked from the start document.');
    const add = command(['source', 'add', 'records', '--kind=directory', '--purpose=fixture', '--locator=records', '--local']);
    assert.equal(add.code, 0, add.err);
    const full = command(['source', 'refresh', 'records', '--json']);
    assert.equal(full.code, 0, full.err);
    const result = command(['source', 'traverse', 'records', '--from=start.md', '--json']);
    assert.equal(result.code, 0, result.err);
    const receipt = JSON.parse(result.out);
    assert.equal(receipt.documents.length, 2);
    assert.equal(receipt.coverage, 'traversed_within_declared_scope');
    assert.equal(currentManifest(fx.broker.store, 'records')!.length, 3, 'bounded traversal cannot delete an unvisited record');
    assert.equal(fx.broker.store.db.prepare("SELECT count(*) AS n FROM activity_events WHERE kind='source.traversed' AND channel='host_source'").get()!.n, 1);
    writeFileSync(join(dir, 'start.md'), '[secret](.env) [escape](escape.md) [remote](https://attacker.invalid/steal)');
    writeFileSync(join(dir, '.env'), 'secret fixture marker');
    symlinkSync(join(fx.box.cwd, 'docs/design.md'), join(dir, 'escape.md'));
    const blocked = command(['source', 'traverse', 'records', '--from=start.md', '--json']);
    assert.equal(blocked.code, 1);
    const denied = JSON.parse(blocked.out);
    assert.equal(denied.documents.length, 1);
    assert.equal(denied.dispositions.length, 3);
    assert.ok(denied.dispositions.every((d: any) => d.status === 'inaccessible'));
    assert.doesNotMatch(blocked.out, /secret fixture marker|Keep the kernel/);
  } finally { fx.cleanup(); }
});
