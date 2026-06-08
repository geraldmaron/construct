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

// Extended-thinking budget requested only when a caller opts into reasoning
// capture (chainOfThought !== 'hidden'). Anthropic requires budget_tokens < the
// turn's max_tokens, so the budget is added on top of the output ceiling.

const REASONING_BUDGET_TOKENS = 1024;

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

// Extended-thinking shape is model-specific. Opus 4.8 / 4.7 REJECT the legacy
// `{type:'enabled', budget_tokens}` form with a 400 and require adaptive
// thinking; Opus 4.6 and Sonnet 4.6 recommend adaptive too. Only genuinely
// older models (Sonnet 4.5 and earlier) still take the budget form. On adaptive
// models `display:'summarized'` is required, or returned thinking blocks carry
// empty text. (Source: claude-api skill — extended/adaptive thinking; ADR-0030.)

function anthropicThinkingConfig(model) {
  const adaptive = /(opus-4-(?:[6-9]|\d\d)|sonnet-4-(?:[6-9]|\d\d))/i.test(model || '');
  return adaptive
    ? { type: 'adaptive', display: 'summarized' }
    : { type: 'enabled', budget_tokens: REASONING_BUDGET_TOKENS };
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

// OpenRouter normalizes reasoning into a plaintext `reasoning` string and/or a
// structured `reasoning_details` array (text / summary / encrypted entries). We
// read the plaintext first, then assemble any readable detail entries; encrypted
// carriers have no displayable text and are skipped.

function extractOpenRouterReasoning(message) {
  if (typeof message.reasoning === 'string' && message.reasoning.trim()) return message.reasoning.trim();
  const details = Array.isArray(message.reasoning_details) ? message.reasoning_details : [];
  return details.map((d) => d?.text || d?.summary || '').filter(Boolean).join('\n').trim();
}

async function callAnthropic({ model, apiKey, system, user, fetchImpl, reasoning }) {
  const thinking = reasoning ? anthropicThinkingConfig(model) : null;
  const body = {
    model: model.replace(/^anthropic\//, ''),
    max_tokens: thinking ? MAX_OUTPUT_TOKENS + REASONING_BUDGET_TOKENS : MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
  };
  if (thinking) body.thinking = thinking;
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw providerError('PROVIDER_EXECUTION_FAILED', `Anthropic specialist execution failed (HTTP ${res.status}): ${await bodyExcerpt(res)}`, 'Verify the model id and ANTHROPIC_API_KEY, or set orchestration.workerBackend to "inline".');
  }
  const data = await res.json();
  const blocks = data.content || [];
  const output = blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('');
  const thought = blocks.filter((b) => b && b.type === 'thinking').map((b) => b.thinking || '').join('').trim();
  return { output, reasoning: thought };
}

async function callOpenRouter({ model, apiKey, system, user, fetchImpl, reasoning }) {
  const body = {
    model: model.replace(/^openrouter\//, ''),
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  // Enable reasoning when wanted; explicitly exclude it otherwise — some models
  // (e.g. Gemini) return reasoning by default, which would leak in hidden mode.
  // An empty `{}` is a no-op on OpenRouter; `{enabled:true}` is the on switch.
  body.reasoning = reasoning ? { enabled: true } : { exclude: true };
  const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'HTTP-Referer': 'https://github.com/geraldmaron/construct' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw providerError('PROVIDER_EXECUTION_FAILED', `OpenRouter specialist execution failed (HTTP ${res.status}): ${await bodyExcerpt(res)}`, 'Verify the model id and OPENROUTER_API_KEY, or set orchestration.workerBackend to "inline".');
  }
  const data = await res.json();
  const message = data.choices?.[0]?.message || {};
  return { output: message.content || '', reasoning: reasoning ? extractOpenRouterReasoning(message) : '' };
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
 * @param {string} [opts.chainOfThought] reasoning disclosure mode: `hidden` (default,
 *        no reasoning requested) | `surface` | `telemetry_only` (both request and
 *        return the model's reasoning for the caller to display or record)
 * @returns {Promise<{output:string, reasoning:string, model:string, provider:string, characters:number}>}
 */
export async function runTaskViaProvider({ task, run, model, provider = null, env = process.env, fetchImpl = globalThis.fetch, chainOfThought = 'hidden' } = {}) {
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
  const wantsReasoning = chainOfThought !== 'hidden';
  const { output, reasoning } = anthropic
    ? await callAnthropic({ model, apiKey, system, user, fetchImpl, reasoning: wantsReasoning })
    : await callOpenRouter({ model, apiKey, system, user, fetchImpl, reasoning: wantsReasoning });

  const text = output || '';
  return {
    output: text,
    reasoning: wantsReasoning ? (reasoning || '') : '',
    model,
    provider: anthropic ? 'anthropic' : 'openrouter',
    characters: text.length,
  };
}
