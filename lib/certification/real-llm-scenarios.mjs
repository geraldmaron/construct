/**
 * lib/certification/real-llm-scenarios.mjs — S3/S8 live evaluation harness for certification.
 *
 * Migrated from tests/functional/real-llm-scenarios.functional.test.mjs. Opt-in via
 * CONSTRUCT_CERTIFY_LIVE=1 or legacy CONSTRUCT_E2E_REAL_LLM=1; skips on missing creds,
 * daemon down, or rate limits without promoting inconclusive to pass. Defaults to
 * OpenRouter (OPENROUTER_API_KEY); Copilot is opt-in via CONSTRUCT_E2E_REAL_LLM_PROVIDER.
 *
 * Spend ceiling: the S3/S8 orchestration legs execute through the runtime's
 * per-run budget accumulator (lib/orchestration/provider-budget.mjs,
 * CONSTRUCT_PROVIDER_BUDGET_USD_CENTS — default 100 cents, -1 disables). The
 * S3 polish call is a direct provider fetch outside that loop, so it carries
 * its own accumulator from the same module: usage is recorded per call and a
 * cap crossing surfaces the ProviderBudgetError remediation (raise the cap,
 * or switch to the host backend at no API cost) as a scenario failure.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assessArtifactQuality } from '../artifact-quality.mjs';
import { hasStoredCredential, listCopilotModels } from '../providers/copilot-auth.mjs';
import { hasSecret, resolveSecret } from '../providers/secret-resolver.mjs';
import { runOrchestration } from '../orchestration/runtime.mjs';
import { createProviderBudget, ProviderBudgetError } from '../orchestration/provider-budget.mjs';
import { orchestrationRun } from '../mcp/tools/orchestration-run.mjs';
import { LIVE_OPT_IN_ENV } from './runner.mjs';
import { projectConfigDir, configPath } from '../config-dir.mjs';

export const LEGACY_LIVE_ENV = 'CONSTRUCT_E2E_REAL_LLM';
export const REAL_LLM_PROVIDER_ENV = 'CONSTRUCT_E2E_REAL_LLM_PROVIDER';
export const REAL_LLM_MODEL_ENV = 'CONSTRUCT_E2E_REAL_LLM_MODEL';
export const REAL_LLM_POLISH_MODEL_ENV = 'CONSTRUCT_E2E_REAL_LLM_POLISH_MODEL';
export const DEFAULT_REAL_LLM_PROVIDER = 'openrouter';
export const DEFAULT_REAL_LLM_MODEL = 'openai/gpt-4o-mini';
export const DEFAULT_REAL_LLM_POLISH_MODEL = 'anthropic/claude-sonnet-4';

const S3_REQUEST = 'Draft a product PRD for per-tenant billing isolation. Include problem, goals, success metrics, user flow, and risks with two sourced citations.';
const PRD_POLISH_MAX_TOKENS = 4096;

export function realLlmOptInEnabled(env = process.env) {
  return env[LIVE_OPT_IN_ENV] === '1' || env[LEGACY_LIVE_ENV] === '1';
}

export function realLlmCredentialsPresent(env = process.env) {
  const allowAmbient = env === process.env;
  return hasSecret('OPENROUTER_API_KEY', { env, allowAmbient })
    || hasSecret('ANTHROPIC_API_KEY', { env, allowAmbient })
    || hasSecret('OPENAI_API_KEY', { env, allowAmbient })
    || hasStoredCredential();
}

export function realLlmSkipReason(env = process.env) {
  if (!realLlmOptInEnabled(env)) {
    return `set ${LIVE_OPT_IN_ENV}=1 or ${LEGACY_LIVE_ENV}=1`;
  }
  if (!realLlmCredentialsPresent(env)) {
    return 'set OPENROUTER_API_KEY (default) or another provider key / Copilot OAuth';
  }
  return null;
}

export function resolveRealLlmProvider(env = process.env) {
  const allowAmbient = env === process.env;
  const requested = (env[REAL_LLM_PROVIDER_ENV] || DEFAULT_REAL_LLM_PROVIDER).trim().toLowerCase();
  const modelOverride = env[REAL_LLM_MODEL_ENV]?.trim() || null;

  if (requested === 'openrouter') {
    if (!hasSecret('OPENROUTER_API_KEY', { env, allowAmbient })) {
      return { skip: 'OPENROUTER_API_KEY required for OpenRouter real-LLM scenarios' };
    }
    return { provider: 'openrouter', model: modelOverride || DEFAULT_REAL_LLM_MODEL };
  }

  if (requested === 'anthropic') {
    if (!hasSecret('ANTHROPIC_API_KEY', { env, allowAmbient })) {
      return { skip: 'ANTHROPIC_API_KEY required for Anthropic real-LLM scenarios' };
    }
    return { provider: 'anthropic', model: modelOverride || 'claude-sonnet-4-20250514' };
  }

  if (requested === 'openai') {
    if (!hasSecret('OPENAI_API_KEY', { env, allowAmbient })) {
      return { skip: 'OPENAI_API_KEY required for OpenAI real-LLM scenarios' };
    }
    return { provider: 'openai', model: modelOverride || 'gpt-4o-mini' };
  }

  if (requested === 'github-copilot' || requested === 'copilot') {
    if (!hasStoredCredential()) {
      return { skip: 'GitHub Copilot OAuth required (construct creds login copilot)' };
    }
    return { provider: 'github-copilot', model: null, requiresAsyncModel: true };
  }

  return { skip: `unknown ${REAL_LLM_PROVIDER_ENV}=${requested}` };
}

function projectDir() {
  const cwd = mkdtempSync(join(tmpdir(), 'cert-real-llm-'));
  mkdirSync(projectConfigDir(cwd), { recursive: true });
  writeFileSync(configPath(cwd, 'context.md'), '# Context\n\nPer-tenant billing isolation initiative.\n');
  return cwd;
}

async function resolveCopilotModel() {
  const models = await listCopilotModels();
  const pick = models.find((id) => /claude|gpt-4/i.test(id)) || models[0];
  if (!pick) throw new Error('No Copilot models returned from /models');
  return pick.startsWith('github-copilot/') ? pick : `github-copilot/${pick}`;
}

async function resolveLiveProvider(env = process.env) {
  const resolved = resolveRealLlmProvider(env);
  if (resolved.skip) return resolved;
  if (resolved.requiresAsyncModel) {
    return { provider: resolved.provider, model: await resolveCopilotModel() };
  }
  return { provider: resolved.provider, model: resolved.model };
}

function tierEnvForModel(model, env) {
  return {
    ...process.env,
    ...env,
    CONSTRUCT_MODEL_REASONING: model,
    CONSTRUCT_MODEL_STANDARD: model,
    CONSTRUCT_MODEL_FAST: model,
  };
}

export function buildPrdPolishMessages({ requestSummary = S3_REQUEST, specialistOutputs = [] } = {}) {
  const blocks = specialistOutputs
    .map((text, index) => `### Specialist ${index + 1}\n${text.trim()}`)
    .join('\n\n');
  const system = [
    'You are product-manager synthesizing a multi-specialist orchestration run into one release-quality PRD markdown file.',
    'Output markdown only — no preamble.',
    'Required ## sections (exact headings): Problem, Goals, Success metrics, Phases, Risks and mitigations.',
    'Under Phases include at least one phase with **FR-<phase>.<n>:** functional requirements and *Acceptance:* criteria per requirement.',
    'You may instead use ## Requirements (or Functional requirements) and ## Acceptance criteria when requirements are not phased inline.',
    'Under Problem and Goals write multi-sentence paragraphs (not bullet-only outlines).',
    'Include a ```mermaid flowchart``` diagram for the user flow.',
    'Include a markdown table with columns: Metric | Baseline | Target (header row required).',
    'Include at least two https citations with (accessed YYYY-MM-DD). Use plausible public sources; mark unknowns [unverified].',
    'Ground content in the specialist outputs; do not invent ticket IDs or customer names.',
  ].join('\n');
  const user = `Product request:\n${requestSummary}\n\nSpecialist chain outputs:\n${blocks}\n\nWrite the complete PRD now.`;
  return { system, user };
}

function resolvePolishModel(env = process.env) {
  return env[REAL_LLM_POLISH_MODEL_ENV]?.trim() || DEFAULT_REAL_LLM_POLISH_MODEL;
}

export const S3_QUALITY_THRESHOLDS = Object.freeze({ minProse: 2, minCitations: 1 });

export function formatArtifactQualityVerdictDetail(
  verdict,
  { minProse = S3_QUALITY_THRESHOLDS.minProse, minCitations = S3_QUALITY_THRESHOLDS.minCitations } = {},
) {
  if (!verdict || typeof verdict !== 'object') {
    return 'quality gate not met after polish';
  }
  const structurePart = verdict.structure?.ok
    ? 'structure: ok'
    : `structure: fail (${(verdict.structure?.errors ?? []).join('; ') || 'unknown'})`;
  const prosePart = `prose: ${verdict.prose?.paragraphs ?? 0}/${minProse} (${verdict.prose?.ok ? 'ok' : 'fail'})`;
  const researchPart = `research: citations=${verdict.research?.citations ?? 0}/${minCitations} unverified=${Boolean(verdict.research?.unverifiedDiscipline)} (${verdict.research?.ok ? 'ok' : 'fail'})`;
  return `quality gate not met after polish; ${structurePart}; ${prosePart}; ${researchPart}`;
}

export function buildS3QualityGateFailure({
  verdict,
  polishModel = null,
  rawOutputLength = null,
  thresholds = S3_QUALITY_THRESHOLDS,
} = {}) {
  return {
    scenarioId: 'real-llm.s3',
    status: 'inconclusive',
    detail: formatArtifactQualityVerdictDetail(verdict, thresholds),
    verdict,
    qualityThresholds: thresholds,
    polishModel,
    rawOutputLength,
  };
}

export function redactRealLlmGateEvidence(result) {
  if (!result?.verdict) return null;
  return JSON.stringify({
    artifactQuality: result.verdict,
    qualityThresholds: result.qualityThresholds ?? S3_QUALITY_THRESHOLDS,
    polishModel: result.polishModel ?? null,
    rawOutputLength: result.rawOutputLength ?? null,
  });
}

async function polishSpecialistOutputsToPrd({ specialistOutputs, requestSummary, env, fetchImpl = globalThis.fetch, budget = null }) {
  try {
    budget?.assertWithinCap();
  } catch (err) {
    if (err instanceof ProviderBudgetError) return { error: `${err.message} ${err.remediation}` };
    throw err;
  }
  if (!hasSecret('OPENROUTER_API_KEY', { env })) {
    return { skip: 'OPENROUTER_API_KEY required for PRD polish synthesis' };
  }
  const apiKey = resolveSecret('OPENROUTER_API_KEY', { env });
  if (!apiKey) return { skip: 'OPENROUTER_API_KEY could not be resolved for PRD polish' };

  const model = resolvePolishModel(env);
  const { system, user } = buildPrdPolishMessages({ requestSummary, specialistOutputs });
  const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/geraldmaron/construct',
      'X-Title': 'Construct certification S3 polish',
    },
    body: JSON.stringify({
      model: model.replace(/^openrouter\//, ''),
      max_tokens: PRD_POLISH_MAX_TOKENS,
      temperature: 0.2,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { error: `OpenRouter polish failed (HTTP ${res.status}): ${body.slice(0, 300)}` };
  }
  const data = await res.json();
  if (budget && data.usage) budget.record(data.usage);
  const text = data.choices?.[0]?.message?.content?.trim() || '';
  if (text.length < 800) {
    return { error: `polish output too short (${text.length} chars)` };
  }
  return { text, polishModel: data.model ?? model };
}

export async function runRealLlmS3({ env = process.env, cleanup = true } = {}) {
  const skip = realLlmSkipReason(env);
  if (skip) return { scenarioId: 'real-llm.s3', status: 'inconclusive', skip };

  const live = await resolveLiveProvider(env);
  if (live.skip) {
    return { scenarioId: 'real-llm.s3', status: 'inconclusive', skip: live.skip };
  }

  const cwd = projectDir();
  try {
    const run = await runOrchestration({
      request: S3_REQUEST,
      workflowType: 'prd-draft',
      requestedStrategy: 'orchestrated',
      host: 'certification',
      hostProvider: live.provider,
      hostModel: live.model,
      fileCount: 2,
      moduleCount: 1,
      workerBackend: 'provider',
    }, {
      cwd,
      workerBackend: 'provider',
      env: tierEnvForModel(live.model, env),
    });

    if (!['completed', 'completed-with-failures'].includes(run.status)) {
      return { scenarioId: 'real-llm.s3', status: 'fail', detail: run.status };
    }

    const outputs = (run.tasks || [])
      .map((task) => (typeof task.output === 'string' ? task.output : ''))
      .filter((text) => text.length > 0);

    const rawLongest = [...outputs].sort((a, b) => b.length - a.length)[0] || '';
    if (!rawLongest || rawLongest.length < 800) {
      return { scenarioId: 'real-llm.s3', status: 'fail', detail: 'insufficient provider output length' };
    }

    const polished = await polishSpecialistOutputsToPrd({
      specialistOutputs: outputs,
      requestSummary: S3_REQUEST,
      env: tierEnvForModel(live.model, env),
      budget: createProviderBudget({ env }),
    });
    if (polished.skip) {
      return { scenarioId: 'real-llm.s3', status: 'inconclusive', skip: polished.skip };
    }
    if (polished.error) {
      return { scenarioId: 'real-llm.s3', status: 'fail', detail: polished.error };
    }

    const prdPath = join(cwd, 'prd-output.md');
    writeFileSync(prdPath, polished.text);
    const verdict = assessArtifactQuality(prdPath, 'prd', S3_QUALITY_THRESHOLDS);
    if (!verdict.ok) {
      return buildS3QualityGateFailure({
        verdict,
        polishModel: polished.polishModel,
        rawOutputLength: rawLongest.length,
      });
    }
    return {
      scenarioId: 'real-llm.s3',
      status: 'pass',
      outputLength: polished.text.length,
      rawOutputLength: rawLongest.length,
      provider: live.provider,
      model: live.model,
      polishModel: polished.polishModel,
      specialistCount: outputs.length,
    };
  } finally {
    if (cleanup) rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export async function runRealLlmS8({ env = process.env } = {}) {
  const skip = realLlmSkipReason(env);
  if (skip) return { scenarioId: 'real-llm.s8', status: 'inconclusive', skip };

  const live = await resolveLiveProvider(env);
  if (live.skip) {
    return { scenarioId: 'real-llm.s8', status: 'inconclusive', skip: live.skip };
  }

  try {
    const result = await orchestrationRun({
      request: 'Summarize a billing-isolation PRD in three bullets.',
      workflow_type: 'prd-draft',
      worker_backend: 'provider',
      host_provider: live.provider,
      host_model: live.model,
      wait: true,
      timeout_ms: 120_000,
    }, { env: tierEnvForModel(live.model, env) });

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
      provider: live.provider,
      model: live.model,
    };
  } catch (err) {
    const message = err?.message ?? String(err);
    if (/ECONNREFUSED|daemon|fetch failed/i.test(message)) {
      return { scenarioId: 'real-llm.s8', status: 'inconclusive', detail: message };
    }
    return { scenarioId: 'real-llm.s8', status: 'fail', detail: message };
  }
}
