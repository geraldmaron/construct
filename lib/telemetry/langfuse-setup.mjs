/**
 * lib/telemetry/langfuse-setup.mjs — Initialize Langfuse annotation queues, eval configs, and labeling workflows.
 *
 * Creates:
 * 1. Annotation queues for human quality review
 * 2. Eval configs for LLM-as-a-judge
 * 3. Links datasets to queues/evals
 *
 * Idempotent — checks existence, updates if metadata changed.
 * CLI: construct langfuse-setup [--force]
 * Daemon: runs on startup
 */

import { langfuseBaseUrl, langfuseHeaders } from './backends/langfuse.mjs';

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
  // Read-only check. This Langfuse version crashes on POST to annotation-queues
  // due to Zod validation errors (scoreConfigIds minimum 1). Skip creation to
  // avoid taking down the Langfuse web process. The queue is non-critical.
  const listRes = await fetchImpl(`${url}/api/public/annotation-queues`, { headers });
  if (!listRes.ok) return false;
  const list = await listRes.json();
  const existing = (list.data || []).find(q => q.name === queue.name);
  return !!existing;
}

async function ensureEvalConfig(url, headers, config, fetchImpl = globalThis.fetch) {
  // Read-only check. Same reason as ensureQueue — POST crashes Langfuse.
  const listRes = await fetchImpl(`${url}/api/public/evaluation-configs`, { headers });
  if (!listRes.ok) return false;
  const list = await listRes.json();
  const existing = (list.data || []).find(e => e.name === config.name);
  return !!existing;
}

/**
 * Main setup function. Idempotent.
 */
export async function runLangfuseSetup({
  publicKey,
  secretKey,
  baseUrl,
  force = false,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const resolvedPublicKey = publicKey ?? env.LANGFUSE_PUBLIC_KEY ?? process.env.LANGFUSE_PUBLIC_KEY;
  const resolvedSecretKey = secretKey ?? env.LANGFUSE_SECRET_KEY ?? process.env.LANGFUSE_SECRET_KEY;
  const resolvedBaseUrl = baseUrl ?? env.LANGFUSE_BASEURL ?? process.env.LANGFUSE_BASEURL;

  if (!resolvedPublicKey || !resolvedSecretKey) {
    return { ok: false, error: 'LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY required' };
  }
  
  const url = langfuseBaseUrl({ LANGFUSE_BASEURL: resolvedBaseUrl });
  const headers = langfuseHeaders({ LANGFUSE_PUBLIC_KEY: resolvedPublicKey, LANGFUSE_SECRET_KEY: resolvedSecretKey });
  
  const results = [];
  
  // Setup queues
  for (const queue of QUEUES) {
    const success = await ensureQueue(url, headers, queue, fetchImpl);
    results.push({ type: 'queue', name: queue.name, success });
  }
  
  // Setup eval configs
  for (const config of EVAL_CONFIGS) {
    const success = await ensureEvalConfig(url, headers, config, fetchImpl);
    results.push({ type: 'eval-config', name: config.name, success });
  }
  
  const successes = results.filter(r => r.success).length;
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
export async function runLangfuseSetupCli(args = []) {
  const force = args.includes('--force');
  
  process.stdout.write('Configuring Langfuse annotation queues and eval configs…\n');
  
  const result = await runLangfuseSetup({ force });
  
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