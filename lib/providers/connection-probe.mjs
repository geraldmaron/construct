/**
 * lib/providers/connection-probe.mjs — lightweight provider auth probes for doctor and tests.
 *
 * Issues a minimal HTTP request per API-key provider to distinguish valid keys from
 * auth failures. Uses injectable fetch so functional tests stay hermetic.
 */

import { resolveFirstSecret } from './secret-resolver.mjs';

const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const ANTHROPIC_MODELS = 'https://api.anthropic.com/v1/models';
const OPENAI_MODELS = 'https://api.openai.com/v1/models';

function classifyStatus(status) {
  if (status === 401 || status === 403) return 'auth_error';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'rate_limited';
  return 'probe_failed';
}

async function probeGet(url, headers, fetchImpl) {
  const res = await fetchImpl(url, { method: 'GET', headers });
  return { ok: classifyStatus(res.status) === 'ok', status: res.status, code: classifyStatus(res.status) };
}

export async function probeProviderConnection(providerId, { env = process.env, cwd = process.cwd(), allowAmbient = true, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) {
    return { ok: false, code: 'fetch_unavailable', status: null, provider: providerId };
  }

  const secretOpts = { env, cwd, allowAmbient };

  if (providerId === 'openrouter') {
    const apiKey = resolveFirstSecret(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], secretOpts);
    if (!apiKey) return { ok: false, code: 'missing_key', status: null, provider: providerId };
    return { provider: providerId, ...(await probeGet(OPENROUTER_MODELS, { Authorization: `Bearer ${apiKey}` }, fetchImpl)) };
  }

  if (providerId === 'anthropic') {
    const apiKey = resolveFirstSecret(['ANTHROPIC_API_KEY'], secretOpts);
    if (!apiKey) return { ok: false, code: 'missing_key', status: null, provider: providerId };
    return {
      provider: providerId,
      ...(await probeGet(ANTHROPIC_MODELS, {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }, fetchImpl)),
    };
  }

  if (providerId === 'openai') {
    const apiKey = resolveFirstSecret(['OPENAI_API_KEY'], secretOpts);
    if (!apiKey) return { ok: false, code: 'missing_key', status: null, provider: providerId };
    return { provider: providerId, ...(await probeGet(OPENAI_MODELS, { Authorization: `Bearer ${apiKey}` }, fetchImpl)) };
  }

  return { ok: false, code: 'unsupported_provider', status: null, provider: providerId };
}
