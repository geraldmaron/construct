/**
 * lib/embed/notifications.mjs — embed action notification bus.
 *
 * Decoupled event emitter for embed daemon → dashboard SSE.
 * The dashboard server subscribes to this bus; the daemon emits events.
 * Slack stub is wired but no-ops without config.
 */

import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(50);

/**
 * Emit a toast notification for an embed action.
 *
 * @param {object} event
 * @param {string} event.type    - 'info' | 'success' | 'warning' | 'error'
 * @param {string} event.source  - job name (e.g. 'docs-lifecycle', 'roadmap', 'snapshot')
 * @param {string} event.message - human-readable description
 * @param {object} [event.meta]  - optional structured metadata
 */
export function emitEmbedNotification(event) {
  bus.emit('embed:action', {
    ...event,
    ts: Date.now(),
  });
}

/**
 * Subscribe to embed notifications.
 * @param {(event: object) => void} handler
 * @returns {() => void} unsubscribe function
 */
export function onEmbedNotification(handler) {
  bus.on('embed:action', handler);
  return () => bus.off('embed:action', handler);
}

/**
 * Stub Slack notification path.
 * Posts to Slack when SLACK_WEBHOOK_URL is set, otherwise no-ops.
 *
 * @param {object} event - same shape as emitEmbedNotification
 * @param {object} [env] - process.env override for testing
 */
export async function notifySlack(event, env = process.env) {
  const webhookUrl = env.SLACK_EMBED_WEBHOOK_URL ?? env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return { sent: false, reason: 'no-webhook-url' };

  try {
    const body = JSON.stringify({
      text: `[${event.source}] ${event.message}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${event.source}* — ${event.message}`,
          },
        },
      ],
    });

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    return { sent: res.ok, status: res.status };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}
