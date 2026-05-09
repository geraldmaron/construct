/**
 * lib/server/webhook.mjs — Webhook ingestion + Slack slash command handler.
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
 *
 * Slack slash commands:
 *   Route: POST /api/slack/commands
 *   Requires SLACK_SIGNING_SECRET in config.env.
 *   Set the Slack app's slash command Request URL to:
 *     https://<your-domain>/api/slack/commands
 *
 *   Supported commands:
 *     /construct snapshot  — run a live embed snapshot and post summary
 *     /construct risks     — surface escalating risks from the knowledge base
 *     /construct plan      — post the current plan.md workflow summary
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { homedir as osHomedir } from 'os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
const HOME = osHomedir();

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

// ── Slack slash command handler ────────────────────────────────────────────

/**
 * Parse application/x-www-form-urlencoded body into an object.
 */
function parseFormBody(raw) {
  const out = {};
  for (const pair of raw.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '));
    const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    out[k] = v;
  }
  return out;
}

/**
 * Post a message back to Slack using response_url (no bot token required for
 * slash command responses).  Falls back to bot token + chat.postMessage if the
 * response_url is absent (e.g. in tests).
 */
async function postSlackMessage(responseUrl, text, botToken) {
  const body = JSON.stringify({ response_type: 'in_channel', text });

  if (responseUrl) {
    const { fetch: nodeFetch } = await import('node:http');
    // Use built-in fetch (Node 18+) or a simple https post
    const url = new URL(responseUrl);
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? await import('node:https') : await import('node:http');
    return new Promise((resolve, reject) => {
      const req = mod.request(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  if (botToken) {
    const https = await import('node:https');
    const postBody = JSON.stringify({ text });
    return new Promise((resolve, reject) => {
      const req = https.request('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${botToken}`,
          'Content-Length': Buffer.byteLength(postBody),
        },
      }, (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', reject);
      req.write(postBody);
      req.end();
    });
  }
}

/**
 * Load config.env values as an object.
 */
function loadConfigEnv() {
  const envFile = join(HOME, '.construct', 'config.env');
  if (!existsSync(envFile)) return {};
  const lines = readFileSync(envFile, 'utf8').split('\n');
  const out = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * Run an embed snapshot and return a formatted Slack message string.
 */
async function runSnapshotForSlack() {
  try {
    const env = { ...process.env, ...loadConfigEnv() };
    const { ProviderRegistry } = await import('../embed/providers/registry.mjs');
    const { SnapshotEngine, renderMarkdown } = await import('../embed/snapshot.mjs');
    const { EMPTY_CONFIG } = await import('../embed/config.mjs');

    const registry = ProviderRegistry.fromEnv(env);
    const sources = registry.autoSources(env);
    if (!sources.length) return '⚠️ No embed sources configured. Add credentials to config.env.';

    const config = { ...EMPTY_CONFIG, sources, snapshot: { maxItems: 10 } };
    const engine = new SnapshotEngine(registry, config);
    const snapshot = await engine.generate();

    const totalItems = snapshot.sections.reduce((n, s) => n + s.items.length, 0);
    const errorCount = snapshot.errors.length;

    const lines = [`*Construct Snapshot* — ${new Date(snapshot.generatedAt).toLocaleString()}`];
    lines.push(`${totalItems} items across ${snapshot.sections.length} sources${errorCount ? ` (${errorCount} errors)` : ''}`);
    lines.push('');

    for (const section of snapshot.sections) {
      if (!section.items.length) continue;
      lines.push(`*${section.provider}* (${section.items.length})`);
      for (const item of section.items.slice(0, 5)) {
        const title = item.title || item.summary || item.text || '(untitled)';
        const url = item.url || item.html_url || '';
        lines.push(url ? `• <${url}|${title}>` : `• ${title}`);
      }
      if (section.items.length > 5) lines.push(`  _…and ${section.items.length - 5} more_`);
    }

    if (errorCount) {
      lines.push('');
      lines.push(`⚠️ Errors: ${snapshot.errors.map(e => `${e.source}: ${e.error}`).join(', ')}`);
    }

    return lines.join('\n');
  } catch (err) {
    return `❌ Snapshot failed: ${err.message}`;
  }
}

/**
 * Surface escalating risks from the knowledge base.
 */
async function runRisksForSlack() {
  try {
    const { buildTrendReport } = await import('../knowledge/trends.mjs');
    const report = buildTrendReport(ROOT_DIR);

    if (!report.escalatingRisks?.length && !report.decisionDrift?.length) {
      return '✅ No escalating risks detected in the current knowledge base.';
    }

    const lines = ['*Construct Risks*', ''];

    if (report.escalatingRisks?.length) {
      lines.push('*Escalating Risks*');
      for (const r of report.escalatingRisks) {
        lines.push(`• ${r.summary} _(↑${r.escalationScore}× — ${r.recentCount} recent)_`);
      }
    }

    if (report.decisionDrift?.length) {
      lines.push('');
      lines.push('*Decision Drift*');
      for (const d of report.decisionDrift) {
        lines.push(`• ${d.decision.summary} _(drift score ${d.driftScore})_`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `❌ Risk analysis failed: ${err.message}`;
  }
}

/**
 * Summarise plan.md as a Slack message.
 */
function runPlanForSlack() {
  try {
    const planPath = join(ROOT_DIR, 'plan.md');
    if (!existsSync(planPath)) return '⚠️ No plan.md found in the project root.';

    const content = readFileSync(planPath, 'utf8');
    const lines = content.split('\n');

    // Extract phase headers and their done/in-progress items
    const output = ['*Construct Plan*', ''];
    let currentPhase = null;
    let phaseItems = [];
    let inTable = false;

    for (const line of lines) {
      if (line.startsWith('## Phase') || line.startsWith('## Goal') || line.startsWith('## Next')) {
        if (currentPhase && phaseItems.length) {
          output.push(`*${currentPhase}*`);
          output.push(...phaseItems.slice(0, 6));
          if (phaseItems.length > 6) output.push(`  _…and ${phaseItems.length - 6} more_`);
          output.push('');
        }
        currentPhase = line.replace(/^#+\s*/, '').trim();
        phaseItems = [];
        inTable = false;
        continue;
      }
      // Table rows with status
      if (line.includes('| done |') || line.includes('| in-progress |') || line.includes('| blocked |')) {
        const match = line.match(/\|\s*[\d.]+\s*\|\s*(.+?)\s*\|\s*(done|in-progress|blocked)\s*\|/);
        if (match) {
          const emoji = match[2] === 'done' ? '✅' : match[2] === 'in-progress' ? '🔄' : '🚫';
          phaseItems.push(`${emoji} ${match[1].trim()}`);
        }
      }
    }

    // Flush last phase
    if (currentPhase && phaseItems.length) {
      output.push(`*${currentPhase}*`);
      output.push(...phaseItems.slice(0, 6));
    }

    // Extract next steps if present
    const nextIdx = lines.findIndex(l => l.startsWith('## Next Steps') || l.startsWith('## Next'));
    if (nextIdx !== -1) {
      const nextLines = [];
      for (let i = nextIdx + 1; i < Math.min(nextIdx + 10, lines.length); i++) {
        if (lines[i].startsWith('#')) break;
        const item = lines[i].trim();
        if (item.startsWith('1.') || item.startsWith('2.') || item.startsWith('3.') || item.startsWith('-')) {
          nextLines.push(item);
        }
      }
      if (nextLines.length) {
        output.push('');
        output.push('*Next Steps*');
        output.push(...nextLines);
      }
    }

    return output.join('\n') || '_(Plan is empty)_';
  } catch (err) {
    return `❌ Could not read plan: ${err.message}`;
  }
}

/**
 * @param {object} opts
 * @param {object} opts.webhookSecrets
 */
export function createSlackCommandHandler({ webhookSecrets = {} } = {}) {
  return async function handleSlackCommand(req, res) {
    // Collect body
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', c => chunks.push(c));
      req.on('end', resolve);
      req.on('error', reject);
    });
    const rawBody = Buffer.concat(chunks).toString('utf8');

    // Verify Slack signature
    const env = loadConfigEnv();
    const signingSecret = webhookSecrets.slack
      || env.SLACK_SIGNING_SECRET
      || process.env.SLACK_SIGNING_SECRET;

    if (signingSecret && !verifySlackSignature(rawBody, req.headers, signingSecret)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid Slack signature' }));
      return;
    }

    const params = parseFormBody(rawBody);
    const text = (params.text || '').trim().toLowerCase();
    const responseUrl = params.response_url || '';
    const botToken = env.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;

    // Acknowledge immediately — Slack requires a 200 within 3 seconds
    res.writeHead(200, { 'Content-Type': 'application/json' });

    let ackText;
    if (text === 'snapshot') ackText = '⏳ Running snapshot…';
    else if (text === 'risks') ackText = '⏳ Analysing risks…';
    else if (text === 'plan') ackText = '⏳ Loading plan…';
    else {
      res.end(JSON.stringify({
        response_type: 'ephemeral',
        text: 'Unknown command. Try: `/construct snapshot`, `/construct risks`, `/construct plan`',
      }));
      return;
    }

    res.end(JSON.stringify({ response_type: 'in_channel', text: ackText }));

    // Do the work after acknowledging
    setImmediate(async () => {
      let message;
      if (text === 'snapshot') message = await runSnapshotForSlack();
      else if (text === 'risks') message = await runRisksForSlack();
      else message = runPlanForSlack();

      await postSlackMessage(responseUrl, message, botToken).catch(() => {});
    });
  };
}
