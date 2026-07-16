/**
 * lib/providers/contract/adapters/slack/governed-write.mjs — envelope-shaped
 * Slack write adapter.
 *
 * Wraps the Slack Web API transport in the provider shape
 * lib/writes/envelope.mjs expects: write(config, payload), meta.id — the
 * only exposed entry point for Slack writes, so dedup, retry, dry-run,
 * approval, and audit stay centralized in the envelope (LMCP-J2) rather than
 * being reimplemented here.
 *
 * Slack has no search-by-content API worth building a marker-based dedup
 * against (unlike GitHub issues or Jira tickets), so this adapter relies on
 * the envelope's own idempotencyKey + sent-log dedup as its only duplicate-
 * send defense — a resend with the same idempotency key is a cache hit, not
 * a second post.
 *
 * `type: 'message'` posts to a channel; `type: 'reply'` posts as a thread
 * reply when `threadTs` is present. No search capability — this adapter does
 * not implement `search()`.
 */

export function createGovernedSlackProvider({ slackTransport } = {}) {
  if (!slackTransport) throw new Error('createGovernedSlackProvider: slackTransport is required');

  async function writeMessage(payload) {
    const { channel, text, threadTs } = payload;
    if (!channel) throw new Error('slack governed write: payload.channel is required');
    if (!text) throw new Error('slack governed write: payload.text is required');

    const result = await slackTransport.postMessage({ channel, text, threadTs });
    return {
      type: threadTs ? 'reply-created' : 'message-created',
      channel: result.channel ?? channel,
      ts: result.ts,
    };
  }

  return {
    meta: {
      id: 'slack',
      displayName: 'Slack (governed)',
      capabilities: ['write'],
      description: 'Envelope-routed Slack channel/thread posts.',
    },

    async write(config, payload) {
      if (payload?.type === 'message' || payload?.type === 'reply') return writeMessage(payload);
      throw new Error(`slack governed write: unsupported type "${payload?.type}" (only 'message' and 'reply' are supported)`);
    },

    /**
     * Render the payload the envelope would submit, without calling the
     * transport. Feeds the envelope's dry-run path.
     *
     * @param {object} payload
     * @returns {{ type: string, channel: string, text: string, threadTs?: string }}
     */
    renderDryRun(payload) {
      if (payload?.type === 'message' || payload?.type === 'reply') {
        return {
          type: payload.type,
          channel: payload.channel,
          text: payload.text,
          ...(payload.threadTs ? { threadTs: payload.threadTs } : {}),
        };
      }
      throw new Error(`slack governed write: cannot render dry-run for unsupported type "${payload?.type}"`);
    },
  };
}

export default createGovernedSlackProvider;
