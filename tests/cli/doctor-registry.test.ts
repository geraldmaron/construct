/**
 * tests/cli/doctor-registry.test.ts — when the committed registry lock is
 * behind the shipped bundles, doctor names `construct skill update`, the
 * command that brings it up to date, and that command does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import { capture, inProject } from './support.ts';

test('doctor names skill update for a lock behind the shipped bundles, and skill update brings it current', async () => {
  await inProject(async (ctx, box) => {
    const lockPath = join(box.cwd, '.construct', 'registry.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { skills: Record<string, { version: string; digest: string }> };
    lock.skills.construct = { ...lock.skills.construct!, version: '0.0.1', digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' };
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

    const behind = await capture(() => run(['doctor'], ctx));
    assert.match(behind.out, /ok {3}registry: .*1 outdated or unlocked \(`construct skill update` locks them\)/);
    assert.doesNotMatch(behind.out, /run init/);

    const updated = await capture(() => run(['skill', 'update'], ctx));
    assert.equal(updated.code, 0, updated.err);
    assert.match(updated.out, /updated: skill:construct/);
    const after = await capture(() => run(['doctor'], ctx));
    assert.match(after.out, /ok {3}registry: (\d+)\/\1 current/);
  });
});
