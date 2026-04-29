/**
 * providers/slack/index.mjs — Slack provider.
 *
 * Transport: Slack Web API (direct fetch, no SDK).
 * Auth: Bot token via SLACK_BOT_TOKEN env var, or config.token.
 *
 * Capabilities: read, write, watch
 *
 * read refs:
 *   "channels"                     → list of public channels the bot is in
 *   "channel:<id>:messages"        → recent messages in a channel (default 20)
 *   "channel:<id>:messages:<n>"    → last n messages
 *   "thread:<channel>:<ts>"        → thread replies
 *   "user:<id>"                    → user profile
 *
 * write items:
 *   { type: 'message', channel, text, thread_ts? }   → post a message
 *   { type: 'reaction', channel, timestamp, emoji }  → add a reaction
 *
 * watch: poll a channel for new messages since last seen timestamp
 *   watch({ channel, since? }, callback) → returns unsubscribe fn
 */

import { AuthError, NotFoundError, RateLimitError } from '../lib/errors.mjs';

const SLACK_API = 'https://slack.com/api';

export default {
  name: 'slack',
  capabilities: ['read', 'write', 'watch'],

  _token: null,
  _pollIntervals: new Map(),

  async init(config = {}) {
    const token = config.token ?? process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new AuthError(
        'Slack provider requires SLACK_BOT_TOKEN or config.token',
        { provider: 'slack' },
      );
    }
    this._token = token;
    const res = await this._call('auth.test', {});
    if (!res.ok) {
      throw new AuthError(`Slack auth failed: ${res.error}`, { provider: 'slack' });
    }
  },

  async _call(method, params) {
    const url = `${SLACK_API}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this._token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(params),
    });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '30', 10);
      throw new RateLimitError('Slack rate limit hit', { provider: 'slack', retryAfter });
    }
    return res.json();
  },

  async read(ref, _opts = {}) {
    if (ref === 'channels') {
      const data = await this._call('conversations.list', { types: 'public_channel,private_channel', limit: 200 });
      if (!data.ok) throw new Error(`Slack error: ${data.error}`);
      return (data.channels ?? []).map((c) => ({
        type: 'channel',
        id: c.id,
        name: c.name,
        isPrivate: c.is_private,
        memberCount: c.num_members,
      }));
    }

    const channelMsgMatch = ref.match(/^channel:([^:]+):messages(?::(\d+))?$/);
    if (channelMsgMatch) {
      const channel = channelMsgMatch[1];
      const limit = parseInt(channelMsgMatch[2] ?? '20', 10);
      const data = await this._call('conversations.history', { channel, limit });
      if (!data.ok) {
        if (data.error === 'channel_not_found') throw new NotFoundError(`Channel not found: ${channel}`, { provider: 'slack' });
        throw new Error(`Slack error: ${data.error}`);
      }
      return (data.messages ?? []).map(normalizeMessage);
    }

    const threadMatch = ref.match(/^thread:([^:]+):(.+)$/);
    if (threadMatch) {
      const [, channel, ts] = threadMatch;
      const data = await this._call('conversations.replies', { channel, ts });
      if (!data.ok) throw new Error(`Slack error: ${data.error}`);
      return (data.messages ?? []).map(normalizeMessage);
    }

    if (ref.startsWith('user:')) {
      const userId = ref.slice(5);
      const data = await this._call('users.info', { user: userId });
      if (!data.ok) {
        if (data.error === 'user_not_found') throw new NotFoundError(`User not found: ${userId}`, { provider: 'slack' });
        throw new Error(`Slack error: ${data.error}`);
      }
      const u = data.user;
      return [{ type: 'user', id: u.id, name: u.name, realName: u.real_name, email: u.profile?.email }];
    }

    throw new NotFoundError(`Unknown Slack read ref: "${ref}"`, { provider: 'slack' });
  },

  async write(item) {
    if (item.type === 'message') {
      const params = { channel: item.channel, text: item.text };
      if (item.thread_ts) params.thread_ts = item.thread_ts;
      if (item.blocks) params.blocks = item.blocks;
      const data = await this._call('chat.postMessage', params);
      if (!data.ok) throw new Error(`Slack error: ${data.error}`);
      return { type: 'message-posted', ts: data.ts, channel: data.channel };
    }

    if (item.type === 'reaction') {
      const data = await this._call('reactions.add', {
        channel: item.channel,
        timestamp: item.timestamp,
        name: item.emoji,
      });
      if (!data.ok && data.error !== 'already_reacted') throw new Error(`Slack error: ${data.error}`);
      return { type: 'reaction-added', emoji: item.emoji };
    }

    throw new Error(`Unknown Slack write item type: "${item.type}"`);
  },

  watch(filter, callback) {
    const channel = filter.channel;
    let since = filter.since ?? String(Date.now() / 1000 - 60);
    const intervalMs = filter.intervalMs ?? 15000;

    const id = setInterval(async () => {
      try {
        const data = await this._call('conversations.history', {
          channel,
          oldest: since,
          limit: 50,
        });
        if (!data.ok) return;
        const messages = (data.messages ?? []).filter((m) => m.ts > since);
        if (messages.length) {
          since = messages[0].ts; // Slack returns newest first
          for (const msg of messages.reverse()) callback(normalizeMessage(msg));
        }
      } catch { /* swallow poll errors — network blip shouldn't kill the watcher */ }
    }, intervalMs);

    this._pollIntervals.set(id, true);
    return () => {
      clearInterval(id);
      this._pollIntervals.delete(id);
    };
  },
};

function normalizeMessage(m) {
  return {
    type: 'message',
    ts: m.ts,
    user: m.user ?? m.bot_id,
    text: m.text,
    threadTs: m.thread_ts ?? null,
    replyCount: m.reply_count ?? 0,
  };
}
