/**
 * tests/kernel/run/coordinator-crash.test.ts — the work log survives a crash
 * mid-run, and the work it names comes back.
 *
 * This one spends a child process and a SIGKILL rather than simulating the
 * crash in-process, because the two properties crash-safety promises are
 * exactly the ones a simulation cannot show: that the entry was already on disk
 * when the process died, and that a killed run leaves a lease rather than a
 * wedge. An in-process fake would be testing the fake.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { getTask, listTasks } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { workRun } from '../../../src/kernel/run/coordinator.ts';
import type { HostResult } from '../../../src/kernel/hosts/interface.ts';

const CHILD = fileURLToPath(new URL('./fixtures/crash-mid-run.ts', import.meta.url));

/** Start a coordinator, wait until a role is in flight, then kill it outright. */
function crashMidRun(dbPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD, dbPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('child never reported ready'));
    }, 20_000);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (!chunk.includes('ready')) return;
      child.kill('SIGKILL');
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.on('error', reject);
  });
}

test('a killed run leaves its log written and its task recoverable', async () => {
  const fixture = sterile();
  const dbPath = join(fixture.root, 'data', 'construct.db');
  try {
    await crashMidRun(dbPath);

    const store = openStore(dbPath);
    try {
      const entries = readWorkLog(store, 'run-1');
      const dispatched = entries.filter((e) => e.action === 'role-dispatched');
      assert.equal(dispatched.length, 1, 'the entry written before the kill must still be there');
      assert.equal(dispatched[0].task, 't-privacy');

      const inFlight = getTask(store, 't-privacy');
      assert.equal(inFlight?.state, 'leased', 'a crash leaves a lease, not a lost task');
      assert.equal(inFlight?.leaseOwner, 'doomed');
      assert.equal(inFlight?.result, null, 'nothing was recorded for work that never finished');

      // And the next run picks it up once that lease has run out.
      const host = {
        name: 'answers',
        kind: 'general',
        capabilities: [],
        init: async (): Promise<void> => {},
        health: async () => ({ live: true }),
        cancel: async () => ({ cancelled: false }),
        invoke: async (request: unknown): Promise<HostResult> => ({
          id: 'x',
          status: 'ok',
          output: {
            text: `${(request as { role: string }).role} reporting`,
            usage: { cost: 0, steps: 1 },
          },
          error: null,
        }),
      };

      const report = await workRun(store, host, {
        owner: 'survivor',
        clock: () => '2026-08-03T01:00:00.000Z',
        spendCeiling: 100,
      });

      assert.equal(report.recovered, 1, 'the orphaned lease is what recovery means');
      assert.equal(report.completed, 2);
      assert.ok(listTasks(store, 'run-1').every((t) => t.state === 'done'));

      const actions = readWorkLog(store, 'run-1').map((e) => e.action);
      assert.ok(actions.includes('lease-recovered'), 'the takeover is itself accountable');
      assert.equal(
        actions.filter((a) => a === 'role-dispatched').length,
        3,
        'the abandoned dispatch stays in the record — the log is what happened, not what should have',
      );
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});
