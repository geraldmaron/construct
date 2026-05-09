/**
 * tests/embed-notifications.test.mjs — notification bus tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitEmbedNotification, onEmbedNotification, notifySlack } from '../lib/embed/notifications.mjs';

describe('embed notifications bus', () => {
  it('emits and receives events', (t, done) => {
    const unsub = onEmbedNotification((event) => {
      assert.equal(event.source, 'test-job');
      assert.equal(event.message, 'hello');
      assert.ok(event.ts);
      unsub();
      done();
    });
    emitEmbedNotification({ type: 'info', source: 'test-job', message: 'hello' });
  });

  it('notifySlack no-ops without webhook URL', async () => {
    const result = await notifySlack(
      { type: 'info', source: 'test', message: 'hi' },
      {}, // empty env
    );
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'no-webhook-url');
  });
});
