/**
 * tests/embed-scheduler.test.mjs — scheduler tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../lib/embed/scheduler.mjs';

describe('Scheduler', () => {
  it('registers a task and returns an id', () => {
    const s = new Scheduler();
    const id = s.register('test', 60_000, async () => {});
    assert.ok(typeof id === 'string' && id.length > 0);
    s.stop();
  });

  it('status lists registered tasks', () => {
    const s = new Scheduler();
    s.register('task-a', 10_000, async () => {});
    s.register('task-b', 20_000, async () => {});
    const st = s.status();
    assert.equal(st.length, 2);
    assert.ok(st.some((t) => t.label === 'task-a'));
    s.stop();
  });

  it('runs a task on schedule', async () => {
    const s = new Scheduler();
    let ran = 0;
    s.register('quick', 20, async () => { ran++; });
    s.start();
    await new Promise((r) => setTimeout(r, 70));
    s.stop();
    assert.ok(ran >= 2, `Expected >=2 runs, got ${ran}`);
  });

  it('runImmediately fires before first interval', async () => {
    const s = new Scheduler();
    let ran = 0;
    s.register('immediate', 60_000, async () => { ran++; }, { runImmediately: true });
    s.start();
    await new Promise((r) => setTimeout(r, 30));
    s.stop();
    assert.ok(ran >= 1);
  });

  it('unregister removes a task', () => {
    const s = new Scheduler();
    const id = s.register('removable', 60_000, async () => {});
    s.start();
    s.unregister(id);
    assert.equal(s.status().length, 0);
    s.stop();
  });

  it('stop clears all timers', async () => {
    const s = new Scheduler();
    let ran = 0;
    s.register('stopper', 20, async () => { ran++; });
    s.start();
    await new Promise((r) => setTimeout(r, 30));
    s.stop();
    const countAtStop = ran;
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(ran, countAtStop);
  });
});
