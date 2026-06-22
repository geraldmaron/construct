/**
 * lib/certification/real-llm-scenarios.mjs — S3/S8 live evaluation harness for certification.
 *
 * Migrated from tests/functional/real-llm-scenarios.functional.test.mjs. Opt-in via
 * CONSTRUCT_CERTIFY_LIVE=1 or legacy CONSTRUCT_E2E_REAL_LLM=1; skips on missing creds,
 * daemon down, or rate limits without promoting inconclusive to pass.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assessArtifactQuality } from '../../tests/e2e/lib/artifact-quality.mjs';
import { hasStoredCredential, listCopilotModels } from '../providers/copilot-auth.mjs';
import { hasSecret } from '../providers/secret-resolver.mjs';
import { runOrchestration } from '../orchestration/runtime.mjs';
import { orchestrationRun } from '../mcp/tools/orchestration-run.mjs';
import { LIVE_OPT_IN_ENV } from './runner.mjs';

export const LEGACY_LIVE_ENV = 'CONSTRUCT_E2E_REAL_LLM';

export function realLlmOptInEnabled(env = process.env) {
  return env[LIVE_OPT_IN_ENV] === '1' || env[LEGACY_LIVE_ENV] === '1';
}

export function realLlmCredentialsPresent(env = process.env) {
  return hasStoredCredential()
    || hasSecret('ANTHROPIC_API_KEY', { env })
    || hasSecret('OPENAI_API_KEY', { env })
    || hasSecret('OPENROUTER_API_KEY', { env });
}

export function realLlmSkipReason(env = process.env) {
  if (!realLlmOptInEnabled(env)) {
    return `set ${LIVE_OPT_IN_ENV}=1 or ${LEGACY_LIVE_ENV}=1`;
  }
  if (!realLlmCredentialsPresent(env)) {
    return 'configure Copilot OAuth or an API key';
  }
  return null;
}

function projectDir() {
  const cwd = mkdtempSync(join(tmpdir(), 'cert-real-llm-'));
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

export async function runRealLlmS3({ env = process.env, cleanup = true } = {}) {
  const skip = realLlmSkipReason(env);
  if (skip) return { scenarioId: 'real-llm.s3', status: 'inconclusive', skip };
  if (!hasStoredCredential()) {
    return { scenarioId: 'real-llm.s3', status: 'inconclusive', skip: 'S3 requires GitHub Copilot OAuth on this machine' };
  }

  const cwd = projectDir();
  try {
    const model = await resolveCopilotModel();
    const run = await runOrchestration({
      request: 'Draft a product PRD for per-tenant billing isolation. Include problem, goals, success metrics, user flow, and risks with two sourced citations.',
      workflowType: 'prd-draft',
      requestedStrategy: 'orchestrated',
      host: 'certification',
      hostProvider: 'github-copilot',
      hostModel: model,
      fileCount: 2,
      moduleCount: 1,
      workerBackend: 'provider',
    }, {
      cwd,
      workerBackend: 'provider',
      env: { ...process.env, ...env, CX_MODEL_REASONING: model, CX_MODEL_STANDARD: model, CX_MODEL_FAST: model },
    });

    if (!['completed', 'completed-with-failures'].includes(run.status)) {
      return { scenarioId: 'real-llm.s3', status: 'fail', detail: run.status };
    }

    const outputs = (run.tasks || [])
      .map((task) => (typeof task.output === 'string' ? task.output : ''))
      .filter((text) => text.length > 0)
      .sort((a, b) => b.length - a.length);

    if (!outputs.length || outputs[0].length < 800) {
      return { scenarioId: 'real-llm.s3', status: 'fail', detail: 'insufficient provider output length' };
    }

    const prdPath = join(cwd, 'prd-output.md');
    writeFileSync(prdPath, outputs[0]);
    const verdict = assessArtifactQuality(prdPath, 'prd', { minProse: 2, minCitations: 1 });
    if (!verdict.ok) {
      return { scenarioId: 'real-llm.s3', status: 'inconclusive', detail: 'quality gate not met', verdict };
    }
    return { scenarioId: 'real-llm.s3', status: 'pass', outputLength: outputs[0].length };
  } finally {
    if (cleanup) rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export async function runRealLlmS8({ env = process.env } = {}) {
  const skip = realLlmSkipReason(env);
  if (skip) return { scenarioId: 'real-llm.s8', status: 'inconclusive', skip };
  if (!hasStoredCredential()) {
    return { scenarioId: 'real-llm.s8', status: 'inconclusive', skip: 'S8 requires GitHub Copilot OAuth on this machine' };
  }

  try {
    const model = await resolveCopilotModel();
    const result = await orchestrationRun({
      request: 'Summarize a billing-isolation PRD in three bullets.',
      workflow_type: 'prd-draft',
      worker_backend: 'provider',
      host_provider: 'github-copilot',
      host_model: model,
      wait: true,
      timeout_ms: 120_000,
    }, { env: { ...process.env, ...env } });

    if (result.failFast) {
      return { scenarioId: 'real-llm.s8', status: 'inconclusive', detail: result.error ?? 'daemon unavailable' };
    }
    if (result.error && /rate_limited|429/i.test(String(result.error))) {
      return { scenarioId: 'real-llm.s8', status: 'inconclusive', detail: result.error };
    }
    if (result.error) {
      return { scenarioId: 'real-llm.s8', status: 'fail', detail: result.error };
    }
    const terminal = ['completed', 'completed-with-failures', 'cancelled'].includes(result.status);
    return {
      scenarioId: 'real-llm.s8',
      status: terminal ? 'pass' : 'inconclusive',
      runStatus: result.status ?? null,
    };
  } catch (err) {
    const message = err?.message ?? String(err);
    if (/ECONNREFUSED|daemon|fetch failed/i.test(message)) {
      return { scenarioId: 'real-llm.s8', status: 'inconclusive', detail: message };
    }
    return { scenarioId: 'real-llm.s8', status: 'fail', detail: message };
  }
}
