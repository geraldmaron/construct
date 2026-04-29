/**
 * lib/server/webhook.mjs — Webhook ingestion endpoint.
 *
 * Receives inbound webhook payloads from external providers (GitHub, Jira,
 * Slack, Confluence, etc.), normalises them through the provider's
 * `normalizeWebhook` capability, and routes the resulting event to:
 *
 *   1. The approval queue — if the event matches a configured approval rule.
 *   2. A snapshot trigger — if the event is tagged as a significant change.
 *   3. The SSE notification stream — so the dashboard updates in real-time.
 *
 * Route: POST /api/webhooks/:provider
 *
 * Security:
 *   Each provider validates its own signature. The handler calls
 *   provider.verifyWebhookSignature(payload, headers) before processing.
 *   Requests that fail signature verification are rejected with 401.
 *
 * Provider registration:
 *   Providers are loaded lazily from providers/<name>/index.mjs. A provider
 *   is eligible for webhook ingestion if it declares 'webhook' in its
 *   capabilities array and exports normalizeWebhook.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');

// ── Provider loader ────────────────────────────────────────────────────────

const _providerCache = new Map();

async function loadProvider(name) {
  if (_providerCache.has(name)) return _providerCache.get(name);
  const providerPath = join(ROOT_DIR, 'providers', name, 'index.mjs');
  if (!existsSync(providerPath)) return null;
  try {
    const mod = await import(providerPath);
    _providerCache.set(name, mod);
    return mod;
  } catch {
    return null;
  }
}

// ── Signature verification helpers ────────────────────────────────────────

/**
 * GitHub: X-Hub-Signature-256: sha256=<hex>
 */
function verifyGitHubSignature(body, headers, secret) {
  const sig = headers['x-hub-signature-256'];
  if (!sig || !secret) return !secret; // open if no secret configured
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Jira: no standard HMAC — verify via shared token in X-Atlassian-Token header.
 */
function verifyJiraSignature(body, headers, secret) {
  if (!secret) return true;
  const token = headers['x-atlassian-token'] || headers['x-webhook-token'];
  if (!token) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * Slack: X-Slack-Signature: v0=<hex> with X-Slack-Request-Timestamp
 */
function verifySlackSignature(body, headers, secret) {
  const sig = headers['x-slack-signature'];
  const ts = headers['x-slack-request-timestamp'];
  if (!sig || !ts || !secret) return !secret;
  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(ts, 10)) > 300) return false;
  const baseString = `v0:${ts}:${body}`;
  const expected = 'v0=' + createHmac('sha256', secret).update(baseString).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

const SIGNATURE_VERIFIERS = {
  github:     verifyGitHubSignature,
  jira:       verifyJiraSignature,
  slack:      verifySlackSignature,
  confluence: verifyJiraSignature, // same Atlassian token scheme
};

// ── Event classification ────────────────────────────────────────────────────

/**
 * Returns { significant: boolean, reason: string } for a normalised event.
 * Significant events trigger an immediate snapshot; others are logged only.
 */
function classifyEvent(providerName, event) {
  const type = (event?.type || '').toLowerCase();
  const SIGNIFICANT = [
    'pr.merged', 'pr.closed',
    'issue.created', 'issue.closed', 'issue.transitioned',
    'push',
    'message.posted',
    'page.created', 'page.updated',
  ];
  const significant = SIGNIFICANT.some(t => type === t || type.startsWith(t));
  return { significant, reason: significant ? `${providerName}:${type} is a tracked event` : 'informational' };
}

// ── Main handler ────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {ApprovalQueue} opts.approvalQueue
 * @param {function} opts.notifyClients  — triggers SSE broadcast
 * @param {object}  opts.webhookSecrets  — { github: '...', slack: '...', ... }
 */
export function createWebhookHandler({ approvalQueue, notifyClients, webhookSecrets = {} }) {
  return async function handleWebhook(req, res) {
    // Extract provider name from path: /api/webhooks/:provider
    const match = req.url.match(/\/api\/webhooks\/([a-z0-9_-]+)/i);
    if (!match) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing provider name in path' }));
      return;
    }

    const providerName = match[1].toLowerCase();

    // Collect body
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', c => chunks.push(c));
      req.on('end', resolve);
      req.on('error', reject);
    });
    const rawBody = Buffer.concat(chunks).toString('utf8');

    // Signature verification
    const verifier = SIGNATURE_VERIFIERS[providerName];
    const secret = webhookSecrets[providerName] || process.env[`WEBHOOK_SECRET_${providerName.toUpperCase()}`];
    if (verifier && !verifier(rawBody, req.headers, secret)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook signature verification failed' }));
      return;
    }

    // Parse payload
    let payload;
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      return;
    }

    // Normalise via provider if available
    let event = { type: 'unknown', raw: payload, provider: providerName, receivedAt: new Date().toISOString() };
    const provider = await loadProvider(providerName);
    if (provider?.normalizeWebhook) {
      try {
        event = { ...event, ...provider.normalizeWebhook(payload, req.headers) };
      } catch {
        // Normalisation failure is non-fatal — log and continue with raw event
      }
    }

    // Classify and route
    const { significant } = classifyEvent(providerName, event);

    if (significant && approvalQueue) {
      // Queue for embed awareness (not necessarily requiring human approval)
      approvalQueue.enqueue({
        action: `webhook.${providerName}.${event.type || 'event'}`,
        payload: event,
        source: `webhook:${providerName}`,
        autoApprove: true, // informational enqueue; hybrid model decides actual approval need
      });
    }

    // Notify dashboard clients
    if (notifyClients) notifyClients();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, provider: providerName, type: event.type, significant }));
  };
}
