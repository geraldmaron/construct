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
    await new Promise((r) => setTimeout(r, 100));
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

// Regression coverage for the bug where the scheduler silently dropped the
// `repeat: false` option, turning a one-time startup job with intervalMs=0
// into setInterval(fn, 0) — which fired every event-loop tick and produced
// 34 GB of duplicate "Telemetry setup skipped" lines in embed-daemon.log.
describe('Scheduler one-shot tasks (repeat: false)', () => {
  it('runs a runImmediately + repeat:false task exactly once', async () => {
    const s = new Scheduler();
    let count = 0;
    s.register('startup-job', 0, async () => { count += 1; }, {
      runImmediately: true,
      repeat: false,
      unref: true,
    });
    s.start();
    await new Promise((r) => setTimeout(r, 50));
    s.stop();
    assert.equal(count, 1, `expected exactly 1 call, got ${count} (pre-fix this was thousands)`);
  });

  it('runs a non-immediate repeat:false task exactly once after intervalMs', async () => {
    const s = new Scheduler();
    let count = 0;
    s.register('delayed-once', 20, async () => { count += 1; }, {
      runImmediately: false,
      repeat: false,
      unref: true,
    });
    s.start();
    await new Promise((r) => setTimeout(r, 80));
    s.stop();
    assert.equal(count, 1, `expected exactly 1 call after delay, got ${count}`);
  });

  it('repeat:true (default) still fires multiple times — no regression', async () => {
    const s = new Scheduler();
    let count = 0;
    s.register('interval-job', 10, async () => { count += 1; }, {
      runImmediately: true,
      unref: true,
    });
    s.start();
    await new Promise((r) => setTimeout(r, 50));
    s.stop();
    assert.ok(count >= 3, `expected at least 3 calls for repeating task, got ${count}`);
  });

  it('status() reports the repeat flag', () => {
    const s = new Scheduler();
    s.register('one-shot', 0, async () => {}, { repeat: false, unref: true });
    s.register('repeating', 100, async () => {}, { unref: true });
    const status = s.status();
    assert.equal(status.find((t) => t.label === 'one-shot').repeat, false);
    assert.equal(status.find((t) => t.label === 'repeating').repeat, true);
  });

  it('stop() clears both intervals and timeouts cleanly', async () => {
    const s = new Scheduler();
    let count = 0;
    s.register('interval-job', 5, async () => { count += 1; }, { unref: true });
    s.register('one-shot', 5, async () => { count += 100; }, { repeat: false, unref: true });
    s.start();
    s.stop();
    const before = count;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(count, before, 'stop() must clear both interval and timeout');
  });
});
