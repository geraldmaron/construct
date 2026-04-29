/**
 * lib/embed/providers/slack.mjs — Slack provider for embed mode.
 *
 * Reads recent messages from one or more channels using the Slack Web API.
 * Zero external deps — uses Node's built-in fetch.
 *
 * Supported refs:
 *   messages   Recent messages in a channel
 *
 * Source config fields (embed.yaml):
 *   provider: slack
 *   channel: C12345678         # single channel ID or name
 *   channels:                  # OR list
 *     - C12345678
 *     - general
 *   refs: [messages]
 *   limit: 20                  # max messages per channel (default: 20)
 *   oldest: 86400              # seconds of history to fetch (default: 86400 = 24h)
 */

const SLACK_API = 'https://slack.com/api';

export class SlackProvider {
  #token;
  #teamId;
  #fetchFn;

  constructor({ token, teamId, fetchFn = globalThis.fetch } = {}) {
    if (!token) throw new Error('SlackProvider requires a token');
    this.#token = token;
    this.#teamId = teamId;
    this.#fetchFn = fetchFn;
  }

  /**
   * @param {string} ref      - 'messages'
   * @param {object} opts     - source config (channel, channels, limit, oldest)
   * @returns {Promise<Item[]>}
   */
  async read(ref, opts = {}) {
    if (ref !== 'messages') throw new Error(`Slack provider: unknown ref "${ref}"`);

    const channels = resolveChannels(opts);
    if (!channels.length) {
      throw new Error(`Slack source requires "channel" or "channels" field`);
    }

    const limit = Number(opts.limit ?? 20);
    const oldestSec = Number(opts.oldest ?? 86400);
    const oldest = String(Math.floor(Date.now() / 1000) - oldestSec);
    const results = [];

    for (const channel of channels) {
      try {
        const channelId = await this.#resolveChannelId(channel);
        const items = await this.#listMessages(channelId, { limit, oldest });
        results.push(...items.map((i) => ({ ...i, channelName: channel })));
      } catch (err) {
        results.push({ type: 'error', source: 'slack', channel, message: err.message });
      }
    }

    return results;
  }

  async #resolveChannelId(channelOrId) {
    // Already looks like an ID (C... or D... or G...)
    if (/^[A-Z][A-Z0-9]{8,}$/.test(channelOrId)) return channelOrId;

    // Resolve by name
    const name = channelOrId.replace(/^#/, '');
    const data = await this.#apiGet('conversations.list', { limit: 200, exclude_archived: true });
    const match = (data.channels ?? []).find(
      (c) => c.name === name || c.name_normalized === name,
    );
    if (!match) throw new Error(`Slack channel not found: ${channelOrId}`);
    return match.id;
  }

  async #listMessages(channelId, { limit, oldest }) {
    const data = await this.#apiGet('conversations.history', {
      channel: channelId,
      limit,
      oldest,
    });

    return (data.messages ?? [])
      .filter((m) => m.type === 'message' && !m.subtype)
      .map((m) => ({
        type: 'message',
        source: 'slack',
        channel: channelId,
        user: m.user ?? m.username ?? 'unknown',
        text: m.text ?? '',
        ts: m.ts,
        threadTs: m.thread_ts ?? null,
        replyCount: m.reply_count ?? 0,
        reactions: (m.reactions ?? []).map((r) => `${r.name}:${r.count}`),
        url: this.#teamId
          ? `https://app.slack.com/client/${this.#teamId}/${channelId}/p${m.ts.replace('.', '')}`
          : null,
        summary: `<${m.user ?? 'unknown'}> ${(m.text ?? '').slice(0, 80)}`,
      }));
  }

  async #apiGet(method, params = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await this.#fetchFn(`${SLACK_API}/${method}?${qs}`, {
        headers: {
          Authorization: `Bearer ${this.#token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(`Slack API error: ${json.error ?? 'unknown'}`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolveChannels(opts) {
  if (Array.isArray(opts.channels)) return opts.channels.filter(Boolean);
  if (opts.channel) return [opts.channel];
  return [];
}
