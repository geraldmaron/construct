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
 *   channels:                  # OR list, optionally with intent tags
 *     - general                # no intent — defaults to 'internal'
 *     - incidents:risk         # channel:intent — drives observation category
 *     - customer-feedback:external
 *   refs: [messages]
 *   limit: 20                  # max messages per channel (default: 20)
 *   oldest: 86400              # seconds of history to fetch (default: 86400 = 24h)
 *
 * SLACK_CHANNELS env format (config.env):
 *   SLACK_CHANNELS=#eng-general,#incidents:risk,#decisions:decision,#customer:external
 *
 * Intent values and their observation category mapping:
 *   internal   → insight       (default — team chat, general discussion)
 *   risk       → anti-pattern  (incidents, alerts, on-call, escalations)
 *   decision   → decision      (decision-making channels, RFC discussions)
 *   external   → insight + tag:external  (customer feedback, support, sales)
 *   how-to     → pattern       (tips, best practices, knowledge sharing)
 *   (none)     → insight       (fallback)
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
   * Auto-discovery: return one source per intent group from SLACK_CHANNELS.
   * Format: SLACK_CHANNELS=#eng-general,#incidents:risk,#decisions:decision
   * Channels without an intent tag default to 'internal'.
   * Each unique intent becomes its own source so snapshot sections are typed.
   */
  defaultSources(env = {}) {
    const raw = env.SLACK_CHANNELS ?? env.SLACK_CHANNEL ?? '';
    const entries = raw.split(',').map((c) => c.trim()).filter(Boolean).map(parseChannelEntry);
    if (!entries.length) return [];

    // Group channels by intent so each source section carries a consistent intent
    const byIntent = new Map();
    for (const { channel, intent } of entries) {
      if (!byIntent.has(intent)) byIntent.set(intent, []);
      byIntent.get(intent).push(channel);
    }

    return [...byIntent.entries()].map(([intent, channels]) => ({
      provider: 'slack',
      refs: ['messages'],
      channels,
      intent,
      oldest: 86400,
      limit: 50,
    }));
  }

  /**
   * @param {string} ref      - 'messages'
   * @param {object} opts     - source config (channel, channels, limit, oldest)
   * @returns {Promise<Item[]>}
   */
  async read(ref, opts = {}) {
    if (ref !== 'messages') throw new Error(`Slack provider: unknown ref "${ref}"`);

    const channelEntries = resolveChannels(opts);
    if (!channelEntries.length) {
      throw new Error(`Slack source requires "channel" or "channels" field`);
    }

    const intent = opts.intent ?? 'internal';
    const limit = Number(opts.limit ?? 20);
    const oldestSec = Number(opts.oldest ?? 86400);
    const oldest = String(Math.floor(Date.now() / 1000) - oldestSec);
    const results = [];

    for (const { channel, intent: entryIntent } of channelEntries) {
      const effectiveIntent = entryIntent ?? intent;
      try {
        const channelId = await this.#resolveChannelId(channel);
        const items = await this.#listMessages(channelId, { limit, oldest });
        results.push(...items.map((i) => ({ ...i, channelName: channel, intent: effectiveIntent })));
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

/**
 * Parse a channel entry that may carry an intent tag: "#name:intent" or "name".
 * Returns { channel: string, intent: string }.
 */
function parseChannelEntry(raw) {
  const s = String(raw).trim().replace(/^#/, '');
  const colonIdx = s.lastIndexOf(':');
  // Avoid splitting channel IDs like C12345678 — intents are alpha-only words
  if (colonIdx > 0 && /^[a-z-]+$/.test(s.slice(colonIdx + 1))) {
    return { channel: s.slice(0, colonIdx), intent: s.slice(colonIdx + 1) };
  }
  return { channel: s, intent: 'internal' };
}

/**
 * Map an intent label to an observation category.
 */
export function intentToCategory(intent) {
  switch ((intent ?? '').toLowerCase()) {
    case 'risk':     return 'anti-pattern';
    case 'decision': return 'decision';
    case 'how-to':
    case 'howto':    return 'pattern';
    default:         return 'insight';
  }
}

function resolveChannels(opts) {
  if (Array.isArray(opts.channels)) return opts.channels.filter(Boolean).map(parseChannelEntry);
  if (opts.channel) return [parseChannelEntry(opts.channel)];
  return [];
}
