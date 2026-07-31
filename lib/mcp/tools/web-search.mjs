/**
 * lib/mcp/tools/web-search.mjs — governed public web search.
 *
 * The one Construct search surface that reaches the public web, kept distinct from the source/repo/
 * local surfaces so it can never be faked or conflated (the contract in
 * docs/notes/research/construct-self-audit/synthesis/web-search-capability-contract.md). Three
 * invariants: (1) every returned result carries a verifiable URL, a claim-relative class, and an
 * Admiralty grade with a derived confidence — results without a URL are dropped, not
 * guessed; (2) every result is labeled `source: 'web'` and the tool never falls back to repo/source
 * search; (3) when no governed provider is configured or the provider is unreachable, the tool
 * returns a typed degradation and zero results rather than claiming it searched the web. The grading
 * itself lives in web-search-governance.mjs, the single chokepoint shared with the orchestration
 * worker's provider-native web path.
 */

import { governWebResults } from './web-search-governance.mjs';

function providerConfig(env) {
  const url = env.WEB_SEARCH_URL;
  if (!url) return null;
  return { url, key: env.WEB_SEARCH_KEY || null };
}

function degraded(reason, note) {
  return { source: 'web', degraded: true, degradationReason: reason, results: [], note };
}

export async function webSearch(args = {}, { env = process.env, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const { query, claim, recency = null } = args;
  if (!query || typeof query !== 'string') {
    return { error: { code: 'INVALID_INPUT', message: 'query (string) is required' } };
  }
  if (!claim || typeof claim !== 'string') {
    return { error: { code: 'INVALID_INPUT', message: 'claim (string) is required — it drives source classification (ADR-0017)' } };
  }

  const provider = providerConfig(env);
  if (!provider) {
    return degraded('capability-unavailable', 'No governed web search provider is configured (set WEB_SEARCH_URL). Construct will not present source or repo search as web search.');
  }

  let payload;
  try {
    const qs = `?q=${encodeURIComponent(query)}${recency ? `&recency=${encodeURIComponent(recency)}` : ''}`;
    const res = await fetchImpl(provider.url + qs, { headers: provider.key ? { Authorization: `Bearer ${provider.key}` } : {} });
    if (!res.ok) return degraded('server-unreachable', `Web search provider returned HTTP ${res.status}`);
    payload = await res.json();
  } catch (err) {
    return degraded('server-unreachable', `Web search provider unreachable: ${err.message}`);
  }

  const items = Array.isArray(payload?.results) ? payload.results : [];
  const results = governWebResults(items, { now });

  return { source: 'web', degraded: false, query, claim, results, dropped: items.length - results.length };
}
