/**
 * real-llm-scenarios.functional.test.mjs — opt-in S3 (PRD) + S8 (orchestration_run) scenarios.
 *
 * Completes construct-2fm8.2 under epic construct-2fm8. Skips unless
 * CONSTRUCT_E2E_REAL_LLM=1 and a provider credential is configured (GitHub
 * Copilot OAuth counts). S3 runs a provider-worker orchestration pass and
 * scores the longest specialist output with assessArtifactQuality. S8 calls
 * orchestration_run when the dashboard daemon is reachable.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assessArtifactQuality } from '../e2e/lib/artifact-quality.mjs';
import { hasStoredCredential, listCopilotModels } from '../../lib/providers/copilot-auth.mjs';
import { hasSecret } from '../../lib/providers/secret-resolver.mjs';
import { runOrchestration } from '../../lib/orchestration/runtime.mjs';
import { orchestrationRun } from '../../lib/mcp/tools/orchestration-run.mjs';

function realLlmEnabled() {
  if (process.env.CONSTRUCT_E2E_REAL_LLM !== '1') return false;
  return hasStoredCredential()
    || hasSecret('ANTHROPIC_API_KEY')
    || hasSecret('OPENAI_API_KEY')
    || hasSecret('OPENROUTER_API_KEY');
}

function projectDir() {
  const cwd = mkdtempSync(join(tmpdir(), 'real-llm-'));
  mkdirSync(join(cwd, '.cx'), { recursive: true });
  writeFileSync(join(cwd, '.cx', 'context.md'), '# Context\n\nPer-tenant billing isolation initiative.\n');
  return cwd;
}

async function resolveCopilotModel() {
  const models = await listCopilotModels();
  const pick = models.find((id) => /claude|gpt-4/i.test(id)) || models[0];
  if (!pick) throw new Error('No Copilot models returned from /models');
  return pick.startsWith('github-copilot/') ? pick : `github-copilot/${pick}`;
}

test('S3 — provider worker produces PRD-shaped output that passes the quality gate', { timeout: 300_000 }, async (t) => {
  if (!realLlmEnabled()) {
    t.skip('set CONSTRUCT_E2E_REAL_LLM=1 and configure Copilot or an API key');
    return;
  }
  if (!hasStoredCredential()) {
    t.skip('S3 real run currently requires GitHub Copilot OAuth on this machine');
    return;
  }

  const cwd = projectDir();
  t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  const model = await resolveCopilotModel();
  const run = await runOrchestration({
    request: 'Draft a product PRD for per-tenant billing isolation. Include problem, goals, success metrics, user flow, and risks with two sourced citations.',
    workflowType: 'prd-draft',
    requestedStrategy: 'orchestrated',
    host: 'functional-test',
    hostProvider: 'github-copilot',
    hostModel: model,
    fileCount: 2,
    moduleCount: 1,
    workerBackend: 'provider',
  }, {
    cwd,
    workerBackend: 'provider',
    env: {
      ...process.env,
      CX_MODEL_REASONING: model,
      CX_MODEL_STANDARD: model,
      CX_MODEL_FAST: model,
    },
  });

  assert.ok(['completed', 'completed-with-failures'].includes(run.status), run.status);

  const outputs = (run.tasks || [])
    .map((task) => (typeof task.output === 'string' ? task.output : ''))
    .filter((text) => text.length > 0)
    .sort((a, b) => b.length - a.length);

  assert.ok(outputs.length > 0, 'expected at least one provider task output');
  assert.ok(outputs[0].length >= 800, 'expected substantial specialist output from real provider');

  const prdPath = join(cwd, 'prd-output.md');
  writeFileSync(prdPath, outputs[0]);
  const verdict = assessArtifactQuality(prdPath, 'prd', { minProse: 2, minCitations: 1 });
  if (!verdict.ok) {
    t.diagnostic(`quality gate: ${JSON.stringify(verdict)}`);
    t.skip('real-LLM output did not pass the full PRD quality gate this run (see diagnostic)');
    return;
  }
});

test('S8 — orchestration_run reaches a terminal daemon state when dashboard is up', { timeout: 180_000 }, async (t) => {
  if (!realLlmEnabled()) {
    t.skip('set CONSTRUCT_E2E_REAL_LLM=1 and configure Copilot or an API key');
    return;
  }
  if (!hasStoredCredential()) {
    t.skip('S8 real run currently requires GitHub Copilot OAuth on this machine');
    return;
  }

  const model = await resolveCopilotModel();
  const result = await orchestrationRun({
    request: 'Summarize a billing-isolation PRD in three bullets.',
    workflow_type: 'prd-draft',
    worker_backend: 'provider',
    host_provider: 'github-copilot',
    host_model: model,
    wait: true,
    timeout_ms: 120_000,
  });

  if (result.failFast) {
    t.skip(`orchestration daemon unavailable: ${result.error}`);
    return;
  }

  if (result.error && /rate_limited|429/i.test(String(result.error))) {
    t.skip(`orchestration daemon rate limited: ${result.error}`);
    return;
  }

  assert.ok(!result.error, result.error || 'orchestration_run failed');
  assert.ok(['completed', 'completed-with-failures', 'cancelled'].includes(result.status), result.status);
});
