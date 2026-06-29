/**
 * lib/mcp/tools/web-search.mjs — governed public web search (construct-rr63.5.3).
 *
 * The one Construct search surface that reaches the public web, kept distinct from the source/repo/
 * local surfaces so it can never be faked or conflated (the contract in
 * docs/notes/research/construct-self-audit/synthesis/web-search-capability-contract.md). Three
 * invariants: (1) every returned result carries a verifiable URL, a claim-relative class, and an
 * Admiralty grade with a derived confidence (ADR-0017) — results without a URL are dropped, not
 * guessed; (2) every result is labeled `source: 'web'` and the tool never falls back to repo/source
 * search; (3) when no governed provider is configured or the provider is unreachable, the tool
 * returns a typed degradation and zero results rather than claiming it searched the web.
 */

const COMMUNITY_HOSTS = ['reddit.com', 'stackoverflow.com', 'news.ycombinator.com', 'discord.com', 'github.com'];
const HIGH_CONFIDENCE_GRADES = new Set(['A1', 'A2', 'B1']);

function providerConfig(env) {
  const url = env.WEB_SEARCH_URL;
  if (!url) return null;
  return { url, key: env.WEB_SEARCH_KEY || null };
}

// Claim-relative class (ADR-0017): community content is admissible primary evidence for sentiment/
// demand claims under a checklist the tool cannot verify deterministically, so it defaults community
// hosts to `tertiary` (conservative for factual claims) and everything else to `secondary`, leaving
// the researcher to promote a community source to primary when the claim is about experience.

function classifyResult(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return COMMUNITY_HOSTS.some((h) => host === h || host.endsWith('.' + h)) ? 'tertiary' : 'secondary';
  } catch {
    return 'tertiary';
  }
}

// Confidence maps from the Admiralty grade; `high` is reserved for A1/A2/B1 (ADR-0017). A grade with
// reliability A/B or credibility 1/2 is `medium`; anything weaker is `low`.

function confidenceFromGrade(grade) {
  if (HIGH_CONFIDENCE_GRADES.has(grade)) return 'high';
  const reliability = grade?.[0];
  const credibility = grade?.[1];
  if (reliability === 'A' || reliability === 'B' || credibility === '1' || credibility === '2') return 'medium';
  return 'low';
}

function degraded(reason, note) {
  return { source: 'web', degraded: true, degradationReason: reason, results: [], note };
}

export async function webSearch(args = {}, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
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
  const results = items
    .filter((it) => it && typeof it.url === 'string' && /^https?:\/\//.test(it.url))
    .map((it) => {
      const admiralty = typeof it.admiralty === 'string' && /^[A-F][1-6]$/.test(it.admiralty) ? it.admiralty : 'C3';
      return {
        source: 'web',
        url: it.url,
        title: typeof it.title === 'string' && it.title ? it.title : it.url,
        snippet: typeof it.snippet === 'string' ? it.snippet : '',
        class: classifyResult(it.url),
        admiralty,
        confidence: confidenceFromGrade(admiralty),
        needsGrading: !(typeof it.admiralty === 'string' && /^[A-F][1-6]$/.test(it.admiralty)),
      };
    });

  return { source: 'web', degraded: false, query, claim, results, dropped: items.length - results.length };
}
