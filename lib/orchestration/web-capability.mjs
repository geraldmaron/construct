/**
 * lib/orchestration/web-capability.mjs — resolve a web-capable specialist's live-web grant (ADR-0050).
 *
 * roleHoldsWebCapability reads the specialist's own declared tools (claudeTools carrying
 * WebSearch/WebFetch) so the web role is derived from the capability map, never a hardcoded
 * string. resolveWebCapability returns a typed WebGrant in strict priority so the same
 * contract governs the local worker, the remote service, and inline mode:
 *   - governed        (WEB_SEARCH_URL set): the worker runs a client tool-use loop over
 *                      Construct's own webSearch(), so F08 grading is preserved by construction.
 *   - provider-native (no WEB_SEARCH_URL): Anthropic web_search_20250305 or OpenRouter
 *                      openrouter:web_search server tool; every citation is re-graded through
 *                      governWebResults so trust:'untrusted' + Admiralty hold identically.
 *   - host-delegated  (explicit opt-in): a tool-capable host executes and returns already-F08
 *                      evidence, re-validated fail-closed on ingress.
 *   - unavailable     (nothing resolves): a typed capability-unavailable that forces an honest
 *                      refusal per rules/common/no-fabrication.md — never a fabricated citation.
 */

import { getSpecialist } from '../registry/loader.mjs';

const DEFAULT_MAX_USES = 5;
const DEFAULT_MAX_RESULTS = 5;

// A specialist is web-execution-capable only when it explicitly declares liveWebAccess.
// claudeTools carries WebSearch/WebFetch on most specialists (the broad Claude-host grant),
// so it is NOT the signal here — the orchestrator routes live-web work to the one role that
// declares the capability (the researcher), keeping the worker web tool least-privilege.
export function roleHoldsWebCapability(role, opts = {}) {
  try {
    const spec = getSpecialist(role, opts.rootDir ? { rootDir: opts.rootDir } : {});
    return spec?.liveWebAccess === true;
  } catch {
    return false;
  }
}

export function resolveWebCapability({ family, env = process.env } = {}) {
  if (env.WEB_SEARCH_URL) {
    return { mode: 'governed' };
  }
  if (family === 'anthropic') {
    const maxUses = Number(env.CONSTRUCT_WORKER_WEB_MAX_USES) || DEFAULT_MAX_USES;
    return { mode: 'provider-native', providerTool: 'anthropic', toolType: 'web_search_20250305', maxUses };
  }
  if (family === 'openrouter') {
    const maxResults = Number(env.CONSTRUCT_WORKER_WEB_MAX_RESULTS) || DEFAULT_MAX_RESULTS;
    return {
      mode: 'provider-native',
      providerTool: 'openrouter',
      toolSpec: { type: 'openrouter:web_search', parameters: { engine: 'auto', max_results: maxResults } },
    };
  }
  // openai / github-copilot have no native web tool wired here; delegate only when
  // explicitly opted in, otherwise the honesty guard fires.
  if (env.CONSTRUCT_ORCHESTRATION_WEB_DELEGATE === '1') {
    return { mode: 'host-delegated' };
  }
  return { mode: 'unavailable', reason: 'capability-unavailable' };
}
