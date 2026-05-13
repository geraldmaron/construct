/**
 * lib/intent-classifier.mjs — LLM-augmented routing verification.
 *
 * Keyword classifiers in orchestration-policy.mjs match by substring. That
 * structurally can't distinguish "fundamentally about X" from "casually
 * mentions X". This module overlays a fast-tier LLM verification step:
 * for each keyword-matched flavor, ask the model whether the match is the
 * true interpretation or incidental. Confidence-thresholded; falls back to
 * the keyword verdict when no model is configured or the call fails.
 *
 * Public API:
 *   verifyIntent({ request, specialist, flavor, matchedKeywords, modelCaller })
 *     → { verified, confidence, reason, source, latencyMs }
 *   verifyRoute(route, { request, modelCaller })
 *     → route with verified roleFlavors + per-role verification records
 *   resetCache() — for tests
 *
 * `modelCaller` is dependency-injected so tests run deterministically; the
 * default uses the OpenRouter free → fast-tier → Anthropic-direct fallback
 * chain mirrored from lib/schema-infer.mjs.
 */

import crypto from 'node:crypto';
import { readCurrentModels, readOpenRouterApiKeyFromOpenCodeConfig } from './model-router.mjs';
import { getUserEnvPath } from './env-config.mjs';

export const INTENT_VERIFY_TIMEOUT_MS = 3000;
export const CONFIDENCE_THRESHOLD = 0.6;

const CACHE = new Map();
const CACHE_MAX = 256;

const SYSTEM_PROMPT = `You judge whether a keyword-based routing classifier match reflects the true intent of a request, or whether the keyword appears incidentally.

Respond with strict JSON only:
{"verified": <boolean>, "confidence": <number 0.0-1.0>, "reason": "<one short sentence>"}

Verified=true means the request is fundamentally about the candidate flavor. Verified=false means the keyword appears casually or the request is about something else.`;

function cacheKey({ request, specialist, flavor }) {
  return crypto.createHash('sha1').update(`${specialist}|${flavor}|${request}`).digest('hex');
}

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  CACHE.delete(key);
  CACHE.set(key, hit);
  return hit;
}

function cacheSet(key, value) {
  CACHE.set(key, value);
  if (CACHE.size > CACHE_MAX) {
    const firstKey = CACHE.keys().next().value;
    CACHE.delete(firstKey);
  }
}

export function resetCache() {
  CACHE.clear();
}

function isApiKeyConfigured() {
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (process.env.OPENROUTER_API_KEY) return true;
  try {
    if (readOpenRouterApiKeyFromOpenCodeConfig()) return true;
  } catch { /* ignore */ }
  return false;
}

function buildUserContent({ request, specialist, flavor, matchedKeywords = [] }) {
  return `Request: "${request}"
Matched specialist: ${specialist}
Candidate flavor: ${flavor}
Matched keywords: ${JSON.stringify(matchedKeywords)}

Is this request fundamentally about ${flavor}, or do the matched keywords appear incidentally?`;
}

function parseJudgeOutput(text) {
  const trimmed = (text || '').trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error('No JSON object in judge output');
  }
  const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  if (typeof parsed.verified !== 'boolean') throw new Error('verified must be boolean');
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('confidence must be number in [0,1]');
  }
  return {
    verified: parsed.verified,
    confidence,
    reason: String(parsed.reason || '').slice(0, 240),
  };
}

async function fetchWithTimeout(url, options, timeoutMs = INTENT_VERIFY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function defaultModelCaller({ system, user }) {
  const orKey = process.env.OPENROUTER_API_KEY || readOpenRouterApiKeyFromOpenCodeConfig();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!orKey && !anthropicKey) throw new Error('no model api key configured');

  const envPath = getUserEnvPath();
  const configured = readCurrentModels(envPath, {});
  const modelId = configured.fast || 'anthropic/claude-haiku-4-5-20251001';
  const isAnthropicDirect = /^anthropic\//.test(modelId);

  if (isAnthropicDirect && anthropicKey) {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId.replace(/^anthropic\//, ''),
        max_tokens: 256,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  if (orKey) {
    const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${orKey}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://github.com/construct',
      },
      body: JSON.stringify({
        model: modelId.replace(/^openrouter\//, ''),
        max_tokens: 256,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openrouter ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  throw new Error('no usable model configured');
}

export async function verifyIntent({ request, specialist, flavor, matchedKeywords = [], modelCaller = defaultModelCaller } = {}) {
  if (!flavor) {
    return { verified: true, confidence: 1, source: 'no-flavor', reason: '', latencyMs: 0 };
  }
  if (process.env.CONSTRUCT_INTENT_VERIFY === 'off') {
    return { verified: true, confidence: 1, source: 'disabled', reason: 'env opt-out', latencyMs: 0 };
  }
  if (modelCaller === defaultModelCaller && !isApiKeyConfigured()) {
    return { verified: true, confidence: 1, source: 'fallback', reason: 'no model api key', latencyMs: 0 };
  }

  const key = cacheKey({ request, specialist, flavor });
  const cached = cacheGet(key);
  if (cached) return { ...cached, source: 'cache' };

  const start = Date.now();
  try {
    const text = await modelCaller({
      system: SYSTEM_PROMPT,
      user: buildUserContent({ request, specialist, flavor, matchedKeywords }),
    });
    const parsed = parseJudgeOutput(text);
    const record = { ...parsed, source: 'llm', latencyMs: Date.now() - start };
    cacheSet(key, record);
    return record;
  } catch (err) {
    return {
      verified: true,
      confidence: 1,
      source: 'fallback',
      reason: `intent-verify error: ${err.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

// Map keyword classifier → matched keywords for explainability in the prompt.
// Kept here (not in orchestration-policy) so the classifier module stays
// the canonical source of "what does verified mean for this role."
const ROLE_PROMPT_KEYWORDS = {
  productManager: ['platform', 'enterprise', 'ai-product', 'growth', 'go-to-market'],
  architect: ['ai-systems', 'integration', 'data model', 'enterprise', 'platform'],
  qa: ['ai-eval', 'api-contract', 'data-pipeline', 'web-ui'],
  security: ['ai', 'privacy', 'supply-chain', 'cloud', 'appsec'],
  dataAnalyst: ['product-intelligence', 'experiment', 'telemetry', 'product-metrics'],
  dataEngineer: ['vector-retrieval', 'warehouse', 'pipeline'],
};

export async function verifyRoute(route, { request, modelCaller = defaultModelCaller } = {}) {
  if (!route || !route.roleFlavors) return route;
  const verifications = {};
  const updatedFlavors = { ...route.roleFlavors };

  for (const [role, flavor] of Object.entries(route.roleFlavors)) {
    if (!flavor) {
      verifications[role] = { verified: true, confidence: 1, source: 'no-flavor', reason: '', latencyMs: 0 };
      continue;
    }
    const result = await verifyIntent({
      request,
      specialist: `cx-${role.replace(/([A-Z])/g, '-$1').toLowerCase()}`,
      flavor,
      matchedKeywords: ROLE_PROMPT_KEYWORDS[role] || [],
      modelCaller,
    });
    verifications[role] = result;
    if (!result.verified || result.confidence < CONFIDENCE_THRESHOLD) {
      updatedFlavors[role] = null;
    }
  }

  return {
    ...route,
    roleFlavors: updatedFlavors,
    verifications,
  };
}
