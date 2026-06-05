/**
 * lib/orchestration/worker.mjs — provider-backed worker backend for the local
 * orchestration runtime.
 *
 * The inline backend (runtime.mjs) PREPARES a specialist task and stops short of
 * model reasoning (ADR-0020). The provider backend closes that gap: it EXECUTES
 * one specialist task by calling the configured provider/model with the
 * specialist's persona prompt as system context and the run's request as the
 * user turn, returning the model's real output (ADR-0021). Because it genuinely
 * runs the model, the prepare-only disclaimer does not apply to provider-executed
 * tasks — runtime.mjs records `task.output` and `executor='provider:<provider>:<model>'`
 * so a host can distinguish prepared from executed work.
 *
 * Provider selection mirrors lib/ingest/provider-extract.mjs: Anthropic
 * `/v1/messages` for Claude-family models, OpenRouter `/v1/chat/completions`
 * otherwise; key resolution reads env (ANTHROPIC_API_KEY / OPENROUTER_API_KEY)
 * and augments with ambient dotenv only when the caller did not inject an
 * explicit env (hermetic-when-explicit). `fetchImpl` is injectable so the path is
 * exercised end to end against a mock provider without a live key. Failures
 * surface as structured codes (PROVIDER_KEY_MISSING, PROVIDER_MODEL_UNRESOLVED,
 * PROVIDER_EXECUTION_FAILED) rather than opaque HTTP errors.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const INLINE = 'inline';
export const PROVIDER = 'provider';
export const WORKER_BACKEND_SET = [INLINE, PROVIDER];

const MAX_OUTPUT_TOKENS = 2048;

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(HERE, '..', '..', 'specialists', 'prompts');

function providerError(code, reason, remediation) {
  const err = new Error(reason);
  err.code = code;
  err.remediation = remediation;
  return err;
}

function isAnthropic(provider, model) {
  return /anthropic|claude/i.test(provider || '') || /claude/i.test(model || '');
}

// Key resolution mirrors provider-extract: env first, then the two cheap dotenv
// files, and only when the caller did not inject an explicit env. A caller that
// passes its own env object (embedded callers, tests) is authoritative and
// hermetic — ambient discovery is suppressed so a developer's real key never
// bleeds into a test run.

function resolveKey(varName, env, allowAmbient) {
  if (env[varName] && typeof env[varName] === 'string' && env[varName].length > 0) return env[varName];
  if (!allowAmbient) return null;
  for (const file of [join(homedir(), '.construct', 'config.env'), join(homedir(), '.env')]) {
    try {
      if (!existsSync(file)) continue;
      const m = readFileSync(file, 'utf8').match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
      if (m && m[1]) return m[1].trim();
    } catch { /* unreadable dotenv is not authoritative */ }
  }
  return null;
}

// The persona prompt is the specialist's system context. It lives in
// specialists/prompts/cx-<role>.md; absent that file, a minimal role-named system
// prompt keeps the backend functional rather than failing on a missing persona.

function loadPersona(role) {
  const slug = String(role || '').replace(/^cx-/, '');
  const file = join(PROMPTS_DIR, `cx-${slug}.md`);
  try {
    if (existsSync(file)) return readFileSync(file, 'utf8');
  } catch { /* unreadable persona falls back to the minimal prompt */ }
  return `You are the ${slug} specialist. Execute your part of the request within your role and return your result directly.`;
}

function buildUserPrompt({ task, run }) {
  const summary = run?.request?.summary || '';
  const reason = task?.reason ? `\n\nWhy you were dispatched: ${task.reason}` : '';
  const handoff = task?.handoffContract ? `\nHandoff contract: ${task.handoffContract}` : '';
  return `Request: ${summary}${reason}${handoff}\n\nDo your part of this request as the ${String(task?.role || '').replace(/^cx-/, '')} specialist. Return your result directly.`;
}

async function bodyExcerpt(res) {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}

async function callAnthropic({ model, apiKey, system, user, fetchImpl }) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model.replace(/^anthropic\//, ''),
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    }),
  });
  if (!res.ok) {
    throw providerError('PROVIDER_EXECUTION_FAILED', `Anthropic specialist execution failed (HTTP ${res.status}): ${await bodyExcerpt(res)}`, 'Verify the model id and ANTHROPIC_API_KEY, or set orchestration.workerBackend to "inline".');
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
}

async function callOpenRouter({ model, apiKey, system, user, fetchImpl }) {
  const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'HTTP-Referer': 'https://github.com/geraldmaron/construct' },
    body: JSON.stringify({
      model: model.replace(/^openrouter\//, ''),
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    throw providerError('PROVIDER_EXECUTION_FAILED', `OpenRouter specialist execution failed (HTTP ${res.status}): ${await bodyExcerpt(res)}`, 'Verify the model id and OPENROUTER_API_KEY, or set orchestration.workerBackend to "inline".');
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Execute one specialist task via the configured provider/model.
 *
 * @param {object} opts
 * @param {object} opts.task            the run task (carries role, reason, handoffContract)
 * @param {object} opts.run             the run (carries request summary)
 * @param {string} opts.model           resolved provider model id
 * @param {string} [opts.provider]      resolved provider id (selects the API)
 * @param {Record<string,string>} [opts.env]
 * @param {Function} [opts.fetchImpl]   injectable fetch (for tests)
 * @returns {Promise<{output:string, model:string, provider:string, characters:number}>}
 */
export async function runTaskViaProvider({ task, run, model, provider = null, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!model) throw providerError('PROVIDER_MODEL_UNRESOLVED', 'Provider worker backend selected but no model resolved.', 'Configure the model tier registry so a model resolves, or set orchestration.workerBackend to "inline".');
  if (typeof fetchImpl !== 'function') throw providerError('PROVIDER_NO_FETCH', 'No fetch implementation available for provider execution.', 'Run on a runtime with global fetch (Node 18+) or inject fetchImpl.');

  const anthropic = isAnthropic(provider, model);
  const keyVar = anthropic ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY';
  const apiKey = resolveKey(keyVar, env, env === process.env);
  if (!apiKey) {
    throw providerError('PROVIDER_KEY_MISSING', `No API key for ${anthropic ? 'Anthropic' : 'OpenRouter'} specialist execution.`, `Set ${keyVar}, or set orchestration.workerBackend to "inline".`);
  }

  const system = loadPersona(task?.role);
  const user = buildUserPrompt({ task, run });
  const output = anthropic
    ? await callAnthropic({ model, apiKey, system, user, fetchImpl })
    : await callOpenRouter({ model, apiKey, system, user, fetchImpl });

  const text = output || '';
  return {
    output: text,
    model,
    provider: anthropic ? 'anthropic' : 'openrouter',
    characters: text.length,
  };
}
