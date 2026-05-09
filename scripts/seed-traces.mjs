#!/usr/bin/env node
/**
 * scripts/seed-traces.mjs — Seed synthetic traces + quality scores into Langfuse.
 *
 * Creates realistic agent traces with a spread of quality scores so that
 * `construct review` and `construct optimize` have data to work with
 * immediately, without waiting for real chat sessions.
 *
 * Usage:
 *   node scripts/seed-traces.mjs [--agents=cx-engineer,cx-architect] [--count=5] [--dry-run]
 *
 * Requires env: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASEURL
 */

import { randomBytes } from 'node:crypto';
import { loadConstructEnv } from '../lib/env-config.mjs';

// ─── Apply config.env so the full keys win over any truncated shell env ──────
const CONF_ENV = loadConstructEnv({ warn: false });
for (const [k, v] of Object.entries(CONF_ENV)) process.env[k] = v;

// ─── CLI args ────────────────────────────────────────────────────────────────
const flags = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);
const DRY_RUN = Boolean(flags['dry-run']);
const COUNT = parseInt(flags.count ?? '5', 10);
const AGENT_LIST = flags.agents
  ? flags.agents.split(',')
  : ['cx-engineer', 'cx-architect', 'cx-reviewer', 'cx-qa', 'cx-debugger'];

// ─── Langfuse config ─────────────────────────────────────────────────────────
const BASE = (process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');

function headers() {
  const key = process.env.LANGFUSE_PUBLIC_KEY;
  const secret = process.env.LANGFUSE_SECRET_KEY;
  if (!key || !secret) { process.stderr.write('Error: LANGFUSE keys not set.\n'); process.exit(1); }
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

async function post(endpoint, body) {
  if (DRY_RUN) { console.log(`[dry-run] POST ${endpoint}`, JSON.stringify(body).slice(0, 120)); return { id: 'dry-run-' + randomBytes(4).toString('hex') }; }
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

// ─── Synthetic content templates ─────────────────────────────────────────────
const INPUTS = [
  'Implement pagination for the users API endpoint',
  'Fix the race condition in the session store',
  'Refactor the auth middleware to use dependency injection',
  'Add retry logic to the embed provider fetch calls',
  'Review the database migration for the observations table',
  'Debug why the scheduler fires twice on startup',
  'Write tests for the knowledge search BM25 scorer',
  'Explain why the daemon heap keeps growing',
  'Add error handling to the snapshot output writer',
  'Create a circuit breaker for the Langfuse trace calls',
];

const OUTPUTS_GOOD = [
  'Added cursor-based pagination with `limit` and `cursor` params. Tests updated. Verified against 10k row fixture.',
  'Root cause: two goroutines writing to the same map without a mutex. Fixed with sync.RWMutex. Added race detector to CI.',
  'Extracted `AuthMiddleware` class, injected via constructor. Backward-compatible — existing call sites untouched.',
  'Implemented exponential backoff (3 retries, 100ms base). Covered by unit tests mocking fetch.',
  'Migration is safe: additive-only columns, default values supplied, no lock contention on existing rows.',
];

const OUTPUTS_POOR = [
  'You can add pagination by adding a page parameter.',
  'The race condition might be caused by threading. Try using a lock.',
  'Refactoring is possible. Consider using a factory pattern or something.',
  'Error handling should be added. Use try/catch blocks.',
  'The migration looks okay but you should test it.',
];

function uuid() { return randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── Seed for one agent ───────────────────────────────────────────────────────
async function seedAgent(agentName, count) {
  console.log(`\nSeeding ${count} traces for ${agentName}...`);
  const traceIds = [];

  for (let i = 0; i < count; i++) {
    const isGood = Math.random() > 0.4; // 60% good, 40% poor
    const traceId = uuid();
    const input = pick(INPUTS);
    const output = isGood ? pick(OUTPUTS_GOOD) : pick(OUTPUTS_POOR);
    const quality = isGood
      ? 0.75 + Math.random() * 0.25   // 0.75–1.0
      : 0.25 + Math.random() * 0.35;  // 0.25–0.60

    const timestamp = new Date(Date.now() - Math.random() * 6 * 86400_000).toISOString();

    // Create trace
    await post('/api/public/traces', {
      id: traceId,
      name: agentName,
      input,
      output,
      timestamp,
      tags: [agentName, 'synthetic-seed'],
      metadata: { synthetic: true, agent: agentName },
    });

    // Create quality score
    await post('/api/public/scores', {
      traceId,
      name: 'quality',
      value: parseFloat(quality.toFixed(3)),
      comment: isGood ? 'Good response — complete and actionable.' : 'Poor response — vague, missing specifics.',
      dataType: 'NUMERIC',
    });

    console.log(`  [${i + 1}/${count}] trace ${traceId.slice(0, 8)}… quality=${quality.toFixed(2)} ${isGood ? '✓' : '✗'}`);
    traceIds.push(traceId);
  }

  return traceIds;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`Seeding synthetic Langfuse traces${DRY_RUN ? ' [DRY RUN]' : ''}`);
console.log(`Agents: ${AGENT_LIST.join(', ')}`);
console.log(`Traces per agent: ${COUNT}\n`);

let total = 0;
for (const agent of AGENT_LIST) {
  const ids = await seedAgent(agent, COUNT);
  total += ids.length;
}

console.log(`\nDone. ${total} traces seeded across ${AGENT_LIST.length} agents.`);
console.log('Run `construct review` to generate stats, then `construct optimize <agent>` to generate patches.');
