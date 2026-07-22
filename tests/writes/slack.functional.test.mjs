/**
 * tests/writes/slack.functional.test.mjs — Slack writes routed through the
 * governed write envelope.
 *
 * Uses a fake Slack transport (no real network) to validate message posts,
 * thread replies, envelope-level idempotency dedup, and Slack's
 * {ok:false, error} rejection shape mapping to a thrown error.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeWithEnvelope } from '../../lib/writes/envelope.mjs';
import { WriteSentLog } from '../../lib/writes/sent-log.mjs';
import { createGovernedSlackProvider } from '../../lib/providers/contract/adapters/slack/governed-write.mjs';

function makeFakeSlackTransport({ rejectWith = null } = {}) {
  const posted = [];
  let nextTs = 1000;
  return {
    posted,
    async postMessage({ channel, text, threadTs }) {
      if (rejectWith) {
        const err = new Error(`Slack API chat.postMessage rejected the request: ${rejectWith}`);
        err.slackError = rejectWith;
        throw err;
      }
      const ts = String(nextTs++);
      posted.push({ channel, text, threadTs, ts });
      return { ts, channel };
    },
  };
}

describe('Slack messages through the governed envelope', () => {
  it('posts a channel message', async () => {
    const transport = makeFakeSlackTransport();
    const provider = createGovernedSlackProvider({ slackTransport: transport });
    const sentLog = new WriteSentLog({});

    const result = await writeWithEnvelope({
      provider,
      config: {},
      payload: { type: 'message', channel: '#general', text: 'hello' },
      dryRun: false,
      sentLog,
    });

    assert.equal(result.status, 'sent');
    assert.equal(transport.posted.length, 1);
    assert.equal(transport.posted[0].channel, '#general');
    assert.equal(transport.posted[0].text, 'hello');
  });

  it('posts a thread reply when threadTs is present', async () => {
    const transport = makeFakeSlackTransport();
    const provider = createGovernedSlackProvider({ slackTransport: transport });
    const sentLog = new WriteSentLog({});

    await writeWithEnvelope({
      provider,
      config: {},
      payload: { type: 'reply', channel: '#general', text: 'a reply', threadTs: '1000' },
      dryRun: false,
      sentLog,
    });

    assert.equal(transport.posted[0].threadTs, '1000');
  });

  it('a repeat with the same explicit idempotency key is a cache hit, not a second post', async () => {
    const transport = makeFakeSlackTransport();
    const provider = createGovernedSlackProvider({ slackTransport: transport });
    const sentLog = new WriteSentLog({});
    const payload = { type: 'message', channel: '#general', text: 'once only' };

    await writeWithEnvelope({ provider, config: {}, payload, dryRun: false, sentLog, idempotencyKey: 'fixed-key' });
    const second = await writeWithEnvelope({ provider, config: {}, payload, dryRun: false, sentLog, idempotencyKey: 'fixed-key' });

    assert.equal(second.status, 'cached');
    assert.equal(transport.posted.length, 1);
  });

  it('a Slack {ok:false} rejection surfaces as an envelope error status', async () => {
    const transport = makeFakeSlackTransport({ rejectWith: 'channel_not_found' });
    const provider = createGovernedSlackProvider({ slackTransport: transport });
    const sentLog = new WriteSentLog({});

    const result = await writeWithEnvelope({
      provider,
      config: {},
      payload: { type: 'message', channel: '#nope', text: 'hello' },
      dryRun: false,
      sentLog,
    });

    assert.equal(result.status, 'error');
  });

  it('rejects an unsupported write type', async () => {
    const provider = createGovernedSlackProvider({ slackTransport: makeFakeSlackTransport() });
    await assert.rejects(() => provider.write({}, { type: 'delete-message' }), /unsupported type/);
  });

  it('requires channel and text', async () => {
    const provider = createGovernedSlackProvider({ slackTransport: makeFakeSlackTransport() });
    await assert.rejects(() => provider.write({}, { type: 'message', text: 'no channel' }), /channel is required/);
    await assert.rejects(() => provider.write({}, { type: 'message', channel: '#general' }), /text is required/);
  });

  it('renderDryRun echoes the payload without calling the transport', () => {
    const transport = makeFakeSlackTransport();
    const provider = createGovernedSlackProvider({ slackTransport: transport });
    const diff = provider.renderDryRun({ type: 'message', channel: '#general', text: 'preview me' });
    assert.equal(diff.channel, '#general');
    assert.equal(diff.text, 'preview me');
    assert.equal(transport.posted.length, 0);
  });
});
