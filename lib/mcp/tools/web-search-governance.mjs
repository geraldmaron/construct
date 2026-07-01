/**
 * lib/mcp/tools/web-search-governance.mjs — the single F08 grader for web evidence.
 *
 * Every web result any specialist or tool ever sees passes through governWebResults here,
 * so the F08 governance invariants (ADR-0017) are produced in exactly one place: a
 * claim-relative class, an Admiralty grade defaulting to C3 with a derived confidence,
 * a normalized date with a 12-month staleness flag, most-recent-first ordering, and the
 * OWASP-LLM01 `trust: 'untrusted'` stamp on externally-sourced text. Results without a
 * verifiable http(s) URL are dropped, never guessed. web-search.mjs (the governed
 * provider tool), the orchestration worker's provider-native web path, and the remote
 * orchestration ingress guard all re-use this grader so a citation can never reach a
 * specialist ungoverned or mislabeled as trusted.
 */

const COMMUNITY_HOSTS = ['reddit.com', 'stackoverflow.com', 'news.ycombinator.com', 'discord.com', 'github.com'];
const HIGH_CONFIDENCE_GRADES = new Set(['A1', 'A2', 'B1']);
const STALE_AFTER_DAYS = 365;

export function normalizeDate(it) {
  const raw = it.date || it.publishedAt || it.published || it.published_at || it.datePublished || null;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

// Claim-relative class (ADR-0017): community content is admissible primary evidence for
// sentiment/demand claims under a checklist the tool cannot verify deterministically, so
// community hosts default to `tertiary` (conservative for factual claims) and everything
// else to `secondary`, leaving the researcher to promote a community source when the claim
// is about experience.

export function classifyResult(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return COMMUNITY_HOSTS.some((h) => host === h || host.endsWith('.' + h)) ? 'tertiary' : 'secondary';
  } catch {
    return 'tertiary';
  }
}

// Confidence maps from the Admiralty grade; `high` is reserved for A1/A2/B1 (ADR-0017). A
// grade with reliability A/B or credibility 1/2 is `medium`; anything weaker is `low`.

export function confidenceFromGrade(grade) {
  if (HIGH_CONFIDENCE_GRADES.has(grade)) return 'high';
  const reliability = grade?.[0];
  const credibility = grade?.[1];
  if (reliability === 'A' || reliability === 'B' || credibility === '1' || credibility === '2') return 'medium';
  return 'low';
}

// Grade one raw item into a governed web result, or null when it carries no verifiable
// http(s) URL. A raw item may come from a governed provider (may carry its own admiralty)
// or a provider-native citation (never does — defaults to C3 + needsGrading).

export function governWebResult(it, { now = Date.now() } = {}) {
  if (!it || typeof it.url !== 'string' || !/^https?:\/\//.test(it.url)) return null;
  const graded = typeof it.admiralty === 'string' && /^[A-F][1-6]$/.test(it.admiralty);
  const admiralty = graded ? it.admiralty : 'C3';
  const date = normalizeDate(it);
  const stale = date != null && (now - Date.parse(date)) > STALE_AFTER_DAYS * 86_400_000;
  return {
    source: 'web',
    url: it.url,
    title: typeof it.title === 'string' && it.title ? it.title : it.url,
    snippet: typeof it.snippet === 'string' ? it.snippet : '',
    class: classifyResult(it.url),
    admiralty,
    confidence: confidenceFromGrade(admiralty),
    date,
    stale,
    needsGrading: !graded,
    // OWASP LLM01: web snippets are externally-sourced data — must not be treated as instructions
    trust: 'untrusted',
  };
}

// Order most-recent-first: fresh dated results, then undated (input order kept by the
// stable sort), then stale ones; newest first within a tier.

function recencyTier(r) {
  return r.date && !r.stale ? 0 : r.date ? 2 : 1;
}

export function governWebResults(items, { now = Date.now() } = {}) {
  const results = (Array.isArray(items) ? items : [])
    .map((it) => governWebResult(it, { now }))
    .filter(Boolean);
  results.sort((a, b) => {
    const t = recencyTier(a) - recencyTier(b);
    if (t !== 0) return t;
    if (a.date && b.date) return Date.parse(b.date) - Date.parse(a.date);
    return 0;
  });
  return results;
}
