/**
 * tests/embed-slack-intent.test.mjs — Slack channel intent tagging tests.
 *
 * Covers:
 *   - parseChannelEntry (via defaultSources grouping)
 *   - intentToCategory mapping
 *   - defaultSources groups channels by intent into separate source entries
 *   - read() carries intent through to returned items
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SlackProvider, intentToCategory } from '../lib/embed/providers/slack.mjs';

// ── intentToCategory ─────────────────────────────────────────────────────────

describe('intentToCategory', () => {
  it('maps risk → anti-pattern', () => {
    assert.equal(intentToCategory('risk'), 'anti-pattern');
  });

  it('maps decision → decision', () => {
    assert.equal(intentToCategory('decision'), 'decision');
  });

  it('maps how-to → pattern', () => {
    assert.equal(intentToCategory('how-to'), 'pattern');
  });

  it('maps howto → pattern', () => {
    assert.equal(intentToCategory('howto'), 'pattern');
  });

  it('maps internal → insight', () => {
    assert.equal(intentToCategory('internal'), 'insight');
  });

  it('maps external → insight', () => {
    assert.equal(intentToCategory('external'), 'insight');
  });

  it('maps unknown → insight', () => {
    assert.equal(intentToCategory('unknown-label'), 'insight');
  });

  it('maps undefined → insight', () => {
    assert.equal(intentToCategory(undefined), 'insight');
  });
});

// ── defaultSources ────────────────────────────────────────────────────────────

describe('SlackProvider.defaultSources', () => {
  const provider = new SlackProvider({ token: 'xoxb-fake' });

  it('returns empty array when SLACK_CHANNELS is unset', () => {
    assert.deepEqual(provider.defaultSources({}), []);
  });

  it('returns empty array when SLACK_CHANNELS is blank', () => {
    assert.deepEqual(provider.defaultSources({ SLACK_CHANNELS: '  ' }), []);
  });

  it('defaults to internal intent when no tag provided', () => {
    const sources = provider.defaultSources({ SLACK_CHANNELS: 'eng-general' });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].intent, 'internal');
    assert.deepEqual(sources[0].channels, ['eng-general']);
  });

  it('strips leading # from channel names', () => {
    const sources = provider.defaultSources({ SLACK_CHANNELS: '#eng-general' });
    assert.equal(sources[0].channels[0], 'eng-general');
  });

  it('parses channel:intent syntax', () => {
    const sources = provider.defaultSources({ SLACK_CHANNELS: '#incidents:risk' });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].intent, 'risk');
    assert.deepEqual(sources[0].channels, ['incidents']);
  });

  it('groups multiple channels with the same intent into one source', () => {
    const sources = provider.defaultSources({
      SLACK_CHANNELS: '#eng:internal,#platform:internal,#incidents:risk',
    });
    assert.equal(sources.length, 2);
    const internal = sources.find((s) => s.intent === 'internal');
    assert.ok(internal, 'expected internal source');
    assert.deepEqual(internal.channels.sort(), ['eng', 'platform']);
    const risk = sources.find((s) => s.intent === 'risk');
    assert.ok(risk, 'expected risk source');
    assert.deepEqual(risk.channels, ['incidents']);
  });

  it('handles all four standard intent labels', () => {
    const sources = provider.defaultSources({
      SLACK_CHANNELS: '#a:internal,#b:risk,#c:decision,#d:how-to',
    });
    const intents = sources.map((s) => s.intent).sort();
    assert.deepEqual(intents, ['decision', 'how-to', 'internal', 'risk']);
  });

  it('does not split channel IDs on colon', () => {
    // Channel IDs like C12345678 — no alpha-only suffix after last colon
    const sources = provider.defaultSources({ SLACK_CHANNELS: 'C12345678' });
    assert.equal(sources[0].channels[0], 'C12345678');
    assert.equal(sources[0].intent, 'internal');
  });

  it('reads SLACK_CHANNEL (singular) as fallback', () => {
    const sources = provider.defaultSources({ SLACK_CHANNEL: 'general' });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].channels[0], 'general');
  });
});

// ── read() intent passthrough ─────────────────────────────────────────────────

describe('SlackProvider.read() — intent passthrough', () => {
  it('attaches intent from source opts to each returned item', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { type: 'message', user: 'U123', text: 'incident in prod', ts: '1700000000.000000' },
        ],
      }),
    });

    const provider = new SlackProvider({ token: 'xoxb-fake', fetchFn: mockFetch });

    const items = await provider.read('messages', {
      channels: ['incidents:risk'],
      intent: 'risk',
      limit: 10,
      oldest: 86400,
    });

    assert.ok(items.length > 0, 'expected at least one item');
    for (const item of items.filter((i) => i.type === 'message')) {
      assert.equal(item.intent, 'risk');
      assert.equal(item.channelName, 'incidents');
    }
  });

  it('defaults intent to internal when not specified in channel entry', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { type: 'message', user: 'U123', text: 'hello world', ts: '1700000000.000001' },
        ],
      }),
    });

    const provider = new SlackProvider({ token: 'xoxb-fake', fetchFn: mockFetch });

    const items = await provider.read('messages', {
      channels: ['general'],
      limit: 10,
      oldest: 86400,
    });

    assert.ok(items.length > 0, 'expected at least one item');
    for (const item of items.filter((i) => i.type === 'message')) {
      assert.equal(item.intent, 'internal');
    }
  });
});
