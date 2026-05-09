/**
 * lib/providers/slack/index.mjs — Slack data-source provider.
 *
 * Capabilities: read, search.
 *
 * Auth: `SLACK_BOT_TOKEN` (xoxb-...) or `SLACK_USER_TOKEN` (xoxp-...) from env.
 *
 * Config (per call):
 *   - channel:  channel id or name (#engineering or C0123)
 *   - query:    free-text search.messages query
 *   - count:    integer (default 20, max 100)
 */

const API = 'https://slack.com/api';
const DEFAULT_COUNT = 20;
const HARD_COUNT = 100;

function token(env) {
  return env.SLACK_BOT_TOKEN || env.SLACK_USER_TOKEN || '';
}

async function slackFetch(method, env, params = {}) {
  const tok = token(env);
  if (!tok) throw new Error('slack: SLACK_BOT_TOKEN or SLACK_USER_TOKEN required');
  const url = new URL(`${API}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (!res.ok) throw new Error(`slack ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`slack api error: ${data.error || 'unknown'}`);
  return data;
}

export function create({ env = process.env } = {}) {
  return {
    meta: {
      id: 'slack',
      displayName: 'Slack',
      capabilities: ['read', 'search'],
      description: 'Channel messages, threads, search.',
    },

    configSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        channel: { type: 'string' },
        query: { type: 'string' },
        count: { type: 'integer', minimum: 1, maximum: HARD_COUNT, default: DEFAULT_COUNT },
      },
    },

    async health() {
      const tok = token(env);
      if (!tok) return { ok: false, detail: 'SLACK_BOT_TOKEN or SLACK_USER_TOKEN not set' };
      try {
        const data = await slackFetch('auth.test', env);
        return { ok: true, detail: `team=${data.team || '?'} user=${data.user || '?'}` };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },

    async read(config) {
      if (!config?.channel) throw new Error('slack.read: config.channel required');
      const limit = Math.min(config?.count || DEFAULT_COUNT, HARD_COUNT);
      const data = await slackFetch('conversations.history', env, { channel: config.channel, limit });
      return data.messages || [];
    },

    async search(config) {
      if (!config?.query) throw new Error('slack.search: config.query required');
      const count = Math.min(config?.count || DEFAULT_COUNT, HARD_COUNT);
      const data = await slackFetch('search.messages', env, { query: config.query, count });
      return data.messages?.matches || [];
    },
  };
}

export default create;
