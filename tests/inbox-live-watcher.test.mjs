/**
 * tests/inbox-live-watcher.test.mjs — debounce + in-flight guard for the
 * reactive inbox watcher. Stubs fs.watch + the inbox watcher so the test
 * exercises the dispatch logic without touching real filesystem events.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InboxLiveWatcher } from '../lib/embed/inbox-live-watcher.mjs';

function makeFakeWatcher() {
  const calls = [];
  let resolveNext;
  return {
    calls,
    dirs() { return ['/tmp/fake-inbox']; },
    async poll() {
      calls.push(Date.now());
      return new Promise((resolve) => {
        resolveNext = () => resolve({ processed: [], skipped: 0, errors: [] });
      });
    },
    completeCurrent() { resolveNext && resolveNext(); resolveNext = null; },
    pendingResolver() { return resolveNext; },
  };
}

function makeFakeWatchFn() {
  const handlers = [];
  const close = () => {};
  return {
    watch(dir, _opts, listener) {
      handlers.push(listener);
      return { close, on: () => {} };
    },
    fire(eventType = 'change', filename = 'dropped.md') {
      for (const h of handlers) h(eventType, filename);
    },
  };
}

describe('InboxLiveWatcher', () => {
  it('debounces a burst of events into one poll', async () => {
    const inboxWatcher = makeFakeWatcher();
    const watchFn = makeFakeWatchFn();
    const live = new InboxLiveWatcher({ inboxWatcher, watchFn: watchFn.watch, debounceMs: 30 });
    live.start();

    watchFn.fire(); watchFn.fire(); watchFn.fire();
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(inboxWatcher.calls.length, 1, 'three rapid events collapse into one poll');
    inboxWatcher.completeCurrent();
    live.stop();
  });

  it('ignores dotfile events (hidden state files inside inbox)', async () => {
    const inboxWatcher = makeFakeWatcher();
    const watchFn = makeFakeWatchFn();
    const live = new InboxLiveWatcher({ inboxWatcher, watchFn: watchFn.watch, debounceMs: 30 });
    live.start();

    watchFn.fire('change', '.inbox-state.json');
    await new Promise((r) => setTimeout(r, 80));

    assert.equal(inboxWatcher.calls.length, 0, 'dotfile changes never trigger a poll');
    live.stop();
  });

  it('queues a follow-up poll when an event fires mid-poll (in-flight guard)', async () => {
    const inboxWatcher = makeFakeWatcher();
    const watchFn = makeFakeWatchFn();
    const live = new InboxLiveWatcher({ inboxWatcher, watchFn: watchFn.watch, debounceMs: 10 });
    live.start();

    watchFn.fire();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(inboxWatcher.calls.length, 1, 'first poll started');

    watchFn.fire();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(inboxWatcher.calls.length, 1, 'second poll did not start while first is in flight');

    inboxWatcher.completeCurrent();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(inboxWatcher.calls.length, 2, 'follow-up poll fired after the first one resolved');

    inboxWatcher.completeCurrent();
    live.stop();
  });

  it('stop() prevents further polls after a pending debounce timer', async () => {
    const inboxWatcher = makeFakeWatcher();
    const watchFn = makeFakeWatchFn();
    const live = new InboxLiveWatcher({ inboxWatcher, watchFn: watchFn.watch, debounceMs: 50 });
    live.start();

    watchFn.fire();
    live.stop();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(inboxWatcher.calls.length, 0, 'no poll after stop()');
  });

  it('reports an actionable error when no inboxWatcher is given', () => {
    assert.throws(() => new InboxLiveWatcher({}), /inboxWatcher is required/);
  });
});
