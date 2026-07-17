/**
 * lib/providers/contract/adapters/slack/transport.mjs — real Slack Web API
 * transport for the governed write adapter.
 *
 * Implements the `slackTransport` shape governed-write.mjs depends on:
 * `postMessage`. Kept separate from governed-write.mjs so tests can inject a
 * fake transport without any network dependency.
 *
 * Auth: bot token via SLACK_BOT_TOKEN env var, or passed directly via config
 * (the same token the read-side SlackProvider uses — lib/embed/providers/registry.mjs).
 *
 * Slack's Web API returns HTTP 200 with `{ok: false, error: "..."}` for most
 * failures (channel_not_found, not_in_channel, ...) rather than a 4xx status,
 * so errors are mapped from the JSON body, not the HTTP status, except for
 * 429 (rate limit), which Slack does signal via HTTP status + Retry-After.
 */

import { AuthError, RateLimitError } from '../../errors.mjs';
import { guardedFetch } from '../../../../net-guard.mjs';

const SLACK_API = 'https://slack.com/api';

export function createSlackTransport(config = {}) {
  const token = config.token ?? process.env.SLACK_BOT_TOKEN;

  if (!token) {
    throw new AuthError('Slack transport requires SLACK_BOT_TOKEN (or config.token)', { provider: 'slack' });
  }

  const allowPrivate = config.allowPrivateEgress ?? process.env.CONSTRUCT_NET_ALLOW_PRIVATE_EGRESS === '1';

  async function call(method, body) {
    const res = await guardedFetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    }, { allowPrivate });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
      throw new RateLimitError('Slack rate limit hit', { provider: 'slack', retryAfter });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Slack API ${method} failed: ${res.status} ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    if (!data.ok) {
      const err = new Error(`Slack API ${method} rejected the request: ${data.error ?? 'unknown error'}`);
      err.slackError = data.error;
      throw err;
    }
    return data;
  }

  return {
    async postMessage({ channel, text, threadTs }) {
      const data = await call('chat.postMessage', {
        channel,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      return { ts: data.ts, channel: data.channel };
    },
  };
}

export default createSlackTransport;
