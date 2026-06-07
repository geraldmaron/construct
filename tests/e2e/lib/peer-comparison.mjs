/**
 * tests/e2e/lib/peer-comparison.mjs — Tier-6 peer-comparison reference data and
 * citation enforcement.
 *
 * Each scenario compares Construct against one community tool on one dimension.
 * The plan's no-fabrication rule is load-bearing here: every comparison claim
 * must cite a primary source (a URL plus the date it was accessed), and no claim
 * may rest on an inferred screenshot or a remembered quote. This module holds
 * the reference rows and a validator that refuses a row whose citations do not
 * resolve to a {url, accessed} pair.
 *
 * The rows carry the scenario, the dimension, the peer, and the peer's primary
 * doc URL. The verdict prose ("better / worse / smallest high-payoff change") is
 * written by the runner at review time against the freshly-fetched source, not
 * baked in here — baking a verdict in would be the fabrication the rule forbids.
 */

export const PEER_ROWS = [
  {
    scenario: 'A',
    dimension: 'Greenfield init noise + next-step clarity',
    peer: 'claude-task-master init',
    sources: [
      { url: 'https://github.com/eyaltoledano/claude-task-master', accessed: null },
      { url: 'https://github.com/eyaltoledano/claude-task-master/issues/1180', accessed: null },
    ],
  },
  {
    scenario: 'B',
    dimension: 'Established-project marker injection + non-destructive scaffolding',
    peer: 'SuperClaude install + ruflo install',
    sources: [
      { url: 'https://github.com/SuperClaude-Org/SuperClaude_Framework/blob/master/docs/getting-started/installation.md', accessed: null },
      { url: 'https://github.com/ruvnet/ruflo', accessed: null },
    ],
  },
  {
    scenario: 'C',
    dimension: 'Research-corpus ingestion + evidence-brief output',
    peer: 'gpt-researcher evidence-brief output',
    sources: [
      { url: 'https://github.com/assafelovic/gpt-researcher', accessed: null },
    ],
  },
];

const URL_RE = /^https?:\/\/[^\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A row is citable only when every source has a resolvable URL and an access
// date. A null `accessed` is the unstamped state — the runner stamps it at fetch
// time; an unstamped row must not be rendered as a finished comparison.

export function validateRow(row) {
  const problems = [];
  if (!row.sources || row.sources.length === 0) problems.push('no primary sources');
  for (const s of row.sources || []) {
    if (!URL_RE.test(s.url || '')) problems.push(`malformed url: ${s.url}`);
    if (s.accessed != null && !DATE_RE.test(s.accessed)) problems.push(`malformed access date: ${s.accessed}`);
  }
  return { ok: problems.length === 0, problems };
}

export function rowForScenario(scenario) {
  return PEER_ROWS.find((r) => r.scenario === scenario) || null;
}

// Stamp the access date onto every source of a row at the moment the runner
// fetches them, producing the citable record the report embeds. The date is
// passed in (the workflow/runtime forbids ambient clocks in some contexts), so
// the caller owns the timestamp.

export function stampAccessDate(row, isoDate) {
  if (!DATE_RE.test(isoDate)) throw new Error(`stampAccessDate: "${isoDate}" is not YYYY-MM-DD`);
  return { ...row, sources: row.sources.map((s) => ({ ...s, accessed: isoDate })) };
}

export function renderCitations(row) {
  return row.sources
    .map((s) => `- ${s.url}${s.accessed ? ` (accessed ${s.accessed})` : ' (unstamped — not yet verified)'}`)
    .join('\n');
}
