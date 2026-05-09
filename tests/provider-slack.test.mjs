/**
 * tests/provider-slack.test.mjs — Slack provider contract + unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runContractTests } from '../providers/lib/contract-tests.mjs';
import provider from '../providers/slack/index.mjs';

runContractTests(provider);

describe('slack provider — init requires token', () => {
  it('throws AuthError when token is missing', async () => {
    const p = Object.create(provider);
    const saved = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    await assert.rejects(
      () => p.init({}),
      (err) => err.code === 'AUTH_ERROR',
    );
    if (saved !== undefined) process.env.SLACK_BOT_TOKEN = saved;
  });
});

describe('slack provider — write item types', () => {
  it('throws on unknown write type', async () => {
    await assert.rejects(
      () => provider.write({ type: 'unknown' }),
      /Unknown Slack write item type/,
    );
  });
});

describe('slack provider — unknown read ref', () => {
  it('throws NotFoundError for unknown ref', async () => {
    await assert.rejects(
      () => provider.read('bananas'),
      (err) => err.code === 'NOT_FOUND',
    );
  });
});

describe('slack provider — watch returns unsubscribe', () => {
  it('watch returns a function', () => {
    // Inject a fake token so no auth check needed
    const p = { ...provider, _token: 'xoxb-fake', _pollIntervals: new Map() };
    const unsub = p.watch({ channel: 'C123', intervalMs: 999999 }, () => {});
    assert.equal(typeof unsub, 'function');
    unsub();
  });
});
