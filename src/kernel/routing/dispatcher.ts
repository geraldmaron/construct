/**
 * kernel/routing/dispatcher.ts — keyword + entitlement route suggestion.
 * Ported from the predecessor's
 * skill-suggestion module; the exact v2 source path is cited in
 * scripts/capture-legacy-dispatcher-golden.mjs, which locks this port.
 *
 * What was worth harvesting here is the scoring model, not the plumbing. v2's
 * module read `skills/routing.json` off a rootDir, cached it by mtime, called
 * a registry loader for entitlements, resolved a workspace preset from a cwd,
 * and loaded a deliverable manifest — five ambient-repo reads wrapped around
 * about thirty lines of actual matching. All five are now caller-supplied
 * inputs, which deletes the mtime cache (nothing to invalidate), the
 * first-root-wins cache bug it existed to work around, and every filesystem
 * touch. Loading routes is a host's job; scoring them is the kernel's.
 *
 * The scoring model itself is unchanged: priority floor, per-keyword score with
 * a stem-prefix match, an adjacency bonus for phrases that appear as
 * consecutive tokens, stopword filtering, and best-score-wins dedup by path.
 */

export interface Route {
  readonly path: string;
  readonly domain?: string;
  readonly keywords?: readonly string[];
  readonly priority?: number;
}

export interface SuggestInput {
  readonly intent?: string;
  readonly routes: readonly Route[];
  /**
   * Paths this role/workspace is entitled to. Omit (undefined) to mark every
   * suggestion entitled — the same open default v2 used when no role was given.
   */
  readonly entitlements?: readonly string[];
  readonly limit?: number;
}

export interface Suggestion {
  readonly path: string;
  readonly domain: string | undefined;
  readonly score: number;
  readonly entitled: boolean;
}

export interface SuggestResult {
  readonly intent: string;
  readonly suggestions: readonly Suggestion[];
}

function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * A keyword part matches a token exactly, or — for a part of 5+ chars — as a
 * prefix of it, so "secret" also matches "secrets". One direction only: a
 * keyword's stem may match its own inflected forms, but a short fragment can
 * never match inside an unrelated longer word. A bidirectional substring check
 * ("rag" matching "storage", "average", "drag") is exactly the false-positive
 * class this replaced.
 */
function partMatches(part: string, tokens: readonly string[]): boolean {
  return tokens.some((t) => t === part || (part.length >= 5 && t.startsWith(part)));
}

/**
 * A phrase like "how is this structured" carries function words that are not
 * why the phrase is a trigger. Left in, the partial-match fallback below lets
 * one of them exact-match an unrelated intent's own stopword and misfire.
 * Filtering never drops every part of a phrase — a phrase that is entirely
 * stopwords falls back to its original parts and still scores as intended.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'this', 'that', 'these', 'those',
  'how', 'to', 'of', 'in', 'on', 'for', 'and', 'or',
]);

function significantParts(kw: string): string[] {
  const parts = kw.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = parts.filter((p) => !STOPWORDS.has(p));
  return filtered.length > 0 ? filtered : parts;
}

function keywordScore(kw: string, tokens: readonly string[]): number {
  const parts = significantParts(kw);
  if (parts.length === 0) return 0;
  if (!parts.every((p) => partMatches(p, tokens))) {
    return parts.some((p) => partMatches(p, tokens)) ? 3 : 0;
  }
  // Adjacency bonus: the parts also appear as consecutive tokens in the intent,
  // not merely present somewhere in it.
  const adjacent =
    parts.length === 1 ||
    tokens.some((_, i) =>
      parts.every((p, j) => {
        const t = tokens[i + j];
        return t !== undefined && (t === p || (p.length >= 5 && t.startsWith(p)));
      }),
    );
  return adjacent ? 10 : 7;
}

function scoreRoute(route: Route, tokens: readonly string[]): number {
  let score = route.priority ?? 1;
  for (const kw of route.keywords ?? []) score += keywordScore(kw, tokens);
  return score;
}

/**
 * Suggest routes for an intent. A route only survives if keywords lifted it
 * above its own priority floor — priority alone never earns a suggestion, so an
 * empty or unmatched intent returns nothing rather than the whole table.
 */
export function suggestRoutes(input: SuggestInput): SuggestResult {
  const intent = input.intent ?? '';
  const limit = input.limit ?? 5;
  const tokens = tokenize(intent);
  const entitled = input.entitlements ? new Set(input.entitlements) : null;

  const scored = input.routes
    .map((route) => ({ route, score: scoreRoute(route, tokens) }))
    .filter((r) => r.score > (r.route.priority ?? 1));

  // Two routes can name the same path (v2 merged a routing table with
  // manifest-derived entries); the best score for a path wins.
  const merged = new Map<string, { route: Route; score: number }>();
  for (const item of scored) {
    const prev = merged.get(item.route.path);
    if (!prev || item.score > prev.score) merged.set(item.route.path, item);
  }

  const suggestions = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ route, score }) => ({
      path: route.path,
      domain: route.domain,
      score,
      entitled: entitled ? entitled.has(route.path) : true,
    }));

  return { intent, suggestions };
}
