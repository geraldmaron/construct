import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { repository, fakeExecutor } from '../hosts/delegation/support.ts';
import { INITIALIZE, LAUNCHER, Session } from './support.ts';
import type { Executor } from '../../src/kernel/delegation/types.ts';

for (const [client, lead] of [['claude-code', 'claude'], ['codex', 'codex'], ['cursor', 'cursor']] as const) {
  test(`${client} MCP lead supervises both other fixture executors, reviews, and integrates serially`, { timeout: 60_000 }, async () => {
    const fixture = repository();
    let session: Session | null = null;
    try {
      const configs = (['claude', 'codex', 'cursor'] as const).map(executor => fakeExecutor(fixture, executor));
      const configDir = join(fixture.home, '.config', 'construct');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'delegation.json'), JSON.stringify({ ...configs[0], executors: Object.assign({}, ...configs.map(config => config.executors)) }));
      const init = spawnSync(process.execPath, [LAUNCHER, 'init', '--no-wire', '--name=delegation-fixture', '--scale=solo', `--skills-dir=${join(fixture.home, 'skills')}`], { cwd: fixture.root, env: fixture.env, encoding: 'utf8' });
      assert.equal(init.status, 0, init.stderr);
      session = new Session(fixture.root, fixture.env, [`--client=${client}`]);
      await session.request('initialize', INITIALIZE);
      await session.ok('bootstrap');
      const parent = await session.ok('work', { action: 'add', title: 'Two independent fixture changes' });
      await session.ok('work', { action: 'claim', id: parent.id });
      const other = (['claude', 'codex', 'cursor'] as Executor[]).filter(executor => executor !== lead);
      const workers: Array<{ id: string; executor: Executor; paths: string[] }> = [];
      for (const [index, executor] of other.entries()) {
        const paths = index === 0 ? ['src/'] : ['README.md'];
        const request = { action: 'start', workId: parent.id, requestKey: `implementation-${executor}`, executor, role: 'implement', instructions: 'edit', paths, acceptance: ['Fixture gate passes'], timeoutMs: 30_000 };
        const started = await session.ok('delegate', request);
        assert.equal((await session.ok('delegate', request)).id, started.id);
        workers.push({ id: String(started.id), executor, paths });
      }
      const settled = async (id: string) => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const status = await session!.ok('delegate', { action: 'status', id });
          if (!['queued', 'running'].includes(String(status.state))) { assert.equal(status.state, 'succeeded', String(status.reason)); return; }
          await delay(25);
        }
        throw new Error('MCP fixture worker did not settle');
      };
      for (const worker of workers) await settled(worker.id);
      for (const [index, worker] of workers.entries()) {
        const review = await session.ok('delegate', { action: 'start', workId: parent.id, requestKey: `review-${worker.executor}`, executor: other[1 - index], role: 'review', subject: worker.id, instructions: 'review', paths: worker.paths, acceptance: ['No concrete defects'], timeoutMs: 30_000 });
        await settled(String(review.id));
        const result = await session.ok('delegate', { action: 'result', id: review.id });
        assert.equal(result.trust, 'data');
        await session.ok('delegate', { action: 'triage', id: review.id, dispositions: [] });
      }
      for (const worker of workers) assert.equal((await session.ok('delegate', { action: 'integrate', id: worker.id })).state, 'integrated');
      assert.equal(readFileSync(join(fixture.root, 'src/value.txt'), 'utf8'), 'worker\n');
      assert.equal(readFileSync(join(fixture.root, 'README.md'), 'utf8'), 'worker\n');
      assert.equal(fixture.git('rev-list', '--count', 'HEAD').trim(), '1');
    } finally {
      if (session) await session.close();
      fixture.cleanup();
    }
  });
}
