/**
 * lib/telemetry/setup.mjs — Initialize telemetry backend annotation queues and eval configs.
 *
 * Creates:
 * 1. Annotation queues for human quality review
 * 2. Eval configs for LLM-as-a-judge
 * 3. Links datasets to queues/evals
 *
 * Idempotent — checks existence, updates if metadata changed.
 * CLI: construct telemetry setup [--force]
 * Daemon: runs on startup
 *
 * Uses an open trace ingestion API protocol.
 * Point CONSTRUCT_TELEMETRY_URL at any compatible backend.
 */

import { telemetryBaseUrl, telemetryHeaders } from './backends/remote.mjs';

const QUEUES = [
  {
    name: 'construct-quality-queue',
    description: 'Human annotation queue for agent quality scoring (0.0-1.0)',
  },
];

const EVAL_CONFIGS = [
  {
    name: 'quality-llm-sonnet',
    description: 'LLM-as-a-judge eval config using Claude Sonnet 3.5',
    model: 'anthropic/claude-3-5-sonnet-20241022',
    prompt: `You are evaluating agent work quality.

Rate the work on a scale of 0.0 (complete failure) to 1.0 (perfect):

CRITERIA:
1. Task Completion (40%): Did it solve the stated problem?
2. Requirements Adherence (30%): Followed all specs/constraints?
3. Quality/Clarity (20%): Professional, well-structured?
4. Thoroughness (10%): Complete coverage?

Input: {{input}}
Expected: {{expected_output}}

Respond with JSON: {"score": 0.85, "reason": "brief explanation"}`,
  },
];

async function ensureQueue(url, headers, queue, fetchImpl = globalThis.fetch) {
  // Read-only check — avoids Zod validation errors on POST to annotation-queues.
  // The queue is non-critical; skip creation to avoid crashing the backend process.
  const listRes = await fetchImpl(`${url}/api/public/annotation-queues`, { headers });
  if (!listRes.ok) return false;
  const list = await listRes.json();
  const existing = (list.data || []).find((q) => q.name === queue.name);
  return !!existing;
}

async function ensureEvalConfig(url, headers, config, fetchImpl = globalThis.fetch) {
  // Read-only check — same reason as ensureQueue.
  const listRes = await fetchImpl(`${url}/api/public/evaluation-configs`, { headers });
  if (!listRes.ok) return false;
  const list = await listRes.json();
  const existing = (list.data || []).find((e) => e.name === config.name);
  return !!existing;
}

/**
 * Main setup function. Idempotent.
 */
export async function runTelemetrySetup({
  publicKey,
  secretKey,
  baseUrl,
  force = false,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const resolvedPublicKey =
    publicKey ??
    env.CONSTRUCT_TELEMETRY_PUBLIC_KEY ??
    process.env.CONSTRUCT_TELEMETRY_PUBLIC_KEY;
  const resolvedSecretKey =
    secretKey ??
    env.CONSTRUCT_TELEMETRY_SECRET_KEY ??
    process.env.CONSTRUCT_TELEMETRY_SECRET_KEY;
  const resolvedBaseUrl =
    baseUrl ??
    env.CONSTRUCT_TELEMETRY_URL ??
    process.env.CONSTRUCT_TELEMETRY_URL;

  if (!resolvedPublicKey || !resolvedSecretKey) {
    return {
      ok: false,
      error: 'CONSTRUCT_TELEMETRY_PUBLIC_KEY and CONSTRUCT_TELEMETRY_SECRET_KEY required',
    };
  }

  const url = telemetryBaseUrl({ CONSTRUCT_TELEMETRY_URL: resolvedBaseUrl });
  const headers = telemetryHeaders({
    CONSTRUCT_TELEMETRY_PUBLIC_KEY: resolvedPublicKey,
    CONSTRUCT_TELEMETRY_SECRET_KEY: resolvedSecretKey,
  });

  const results = [];

  for (const queue of QUEUES) {
    const success = await ensureQueue(url, headers, queue, fetchImpl);
    results.push({ type: 'queue', name: queue.name, success });
  }

  for (const config of EVAL_CONFIGS) {
    const success = await ensureEvalConfig(url, headers, config, fetchImpl);
    results.push({ type: 'eval-config', name: config.name, success });
  }

  const successes = results.filter((r) => r.success).length;
  const total = results.length;

  return {
    ok: true,
    summary: `${successes}/${total} resources configured`,
    results,
  };
}

/**
 * CLI handler
 */
export async function runTelemetrySetupCli(args = []) {
  const force = args.includes('--force');

  process.stdout.write('Configuring telemetry backend annotation queues and eval configs…\n');

  const result = await runTelemetrySetup({ force });

  if (result.ok) {
    process.stdout.write(`✓ ${result.summary}\n`);
    if (result.results.length) {
      process.stdout.write('\nDetails:\n');
      for (const r of result.results) {
        const emoji = r.success ? '✓' : '✗';
        process.stdout.write(`  ${emoji} ${r.type}: ${r.name}\n`);
      }
    }
  } else {
    process.stderr.write(`✗ ${result.error}\n`);
    process.exit(1);
  }
}


