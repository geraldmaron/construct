/**
 * lib/mcp/tool-budget.mjs — tool-surface sizing for the OpenCode integration.
 *
 * OpenCode 1.15.4 exposes no per-session tool filter (chat.params carries only
 * sampler params, and tool.definition cannot remove a tool or see the model), so
 * the serialized tool surface is fixed by two config/server-time levers:
 *   1. construct-mcp's ListTools — a lean core + the construct_call gateway.
 *   2. which external MCP servers are `enabled` in opencode.json — sync disables
 *      the heavy ones for local-capable setups (they cannot be trimmed at runtime).
 * Holds the shared token-sizing helper and the external-server id list both
 * levers reason about. Locality also covers openai-compatible providers whose
 * options.baseURL is loopback, RFC1918, or Tailscale CGNAT (100.64/10).
 */

import { getMeasuredHeavyExternalMcpTokenCost } from './external-schema-cost.mjs';

const TOKENS_PER_CHAR = 0.25;

// Heavy external MCP servers Construct registers globally. On a local-capable
// setup these serialize a measured ~37k tokens of tool schema into every agent's
// window (github alone ~30k as of 2026-06-22; see tests/fixtures/mcp-tool-schemas/
// and scripts/measure-external-mcp-schemas.mjs) and cannot be filtered per request,
// so sync disables them in opencode.json. construct-mcp's own knowledge_search /
// memory_search cover the search/memory cases.

export const HEAVY_EXTERNAL_MCP_IDS = ['context7', 'github', 'memory', 'sequential-thinking', 'playwright'];

export const LOCAL_SURFACE_MODES = ['auto', 'on', 'off'];

function ipv4Octets(hostname) {
  const m = String(hostname || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map((n) => Number(n));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

function isPrivateOrLoopbackIpv4(octets) {
  const [a, b] = octets;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;

  // Tailscale CGNAT 100.64.0.0/10

  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// True when baseURL points at loopback, RFC1918, or Tailscale CGNAT — the
// openai-compatible mirrors of local Ollama (Corsair over Tailscale, LAN boxes).

export function isLoopbackOrPrivateBaseUrl(baseURL) {
  if (!baseURL || typeof baseURL !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(baseURL);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '::1') return true;
  const octets = ipv4Octets(host);
  if (octets) return isPrivateOrLoopbackIpv4(octets);
  return false;
}

function providerIdFromModel(model) {
  const raw = String(model || '').trim();
  if (!raw.includes('/')) return null;
  return raw.split('/')[0].toLowerCase() || null;
}

function providerBaseUrlLooksLocal(model, providers) {
  if (!providers || typeof providers !== 'object') return false;
  const providerId = providerIdFromModel(model);
  if (!providerId) return false;
  const entry = providers[providerId] ?? providers[Object.keys(providers).find((k) => k.toLowerCase() === providerId)];
  const baseURL = entry?.options?.baseURL;
  return isLoopbackOrPrivateBaseUrl(baseURL);
}

// A model benefits from trimming only when it is a small-context local runtime
// reached over Ollama/localhost, or an openai-compatible provider whose baseURL
// is private/Tailscale. github-copilot is a hosted, full-context proxy, so it is
// deliberately not "local" here even though it is provider-local.

export function isLocalModel(model, { providers } = {}) {
  const m = (model || '').toLowerCase();
  if (!m) return false;
  if (m.startsWith('local/')) return true;
  if (m.includes('ollama') || m.includes('localhost') || m.includes('127.0.0.1')) return true;
  return providerBaseUrlLooksLocal(model, providers);
}

// Decide whether to disable the heavy external MCP servers for one opencode.json.
// Trimming is driven by INTENT — the default model this config actually selects —
// not by whether the machine happens to have Ollama installed. Machine-wide
// presence stripped context7/github from cloud sessions that merely shared a box
// with Ollama; keying off the config's own default model preserves cloud surfaces
// and still shrinks the window when the user has chosen a local model.
//   surface: 'on' (always trim) | 'off' (never) | 'auto' (trim iff default is local)

export function decideTrim({ surface = 'auto', defaultModel = null, providers } = {}) {
  if (surface === 'off') return false;
  if (surface === 'on') return true;
  return isLocalModel(defaultModel, { providers });
}

export function estimateToolTokens(tools) {
  if (!tools) return 0;
  const arr = Array.isArray(tools) ? tools : Object.values(tools);
  return Math.round(JSON.stringify(arr).length * TOKENS_PER_CHAR);
}

export { getMeasuredHeavyExternalMcpTokenCost };
