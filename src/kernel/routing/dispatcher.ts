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
 * Reduce a simple English plural to its singular, for comparison only.
 *
 * Deliberately narrow. This is not a stemmer and must not become one: it exists
 * because the prefix rule below runs in one direction, so a keyword written
 * plural ("students") could never match a singular token ("student"), while the
 * reverse worked fine. The catalog had been compensating by hand — it lists
 * "contractor" and "contractors", "employee" and "employees", "refund" and
 * "refunds" — and silently lost wherever the author did not think to
 *.
 *
 * "access" and "business" keep their double s, so the rule cannot maul a word
 * that merely ends in one. Short words are left alone: "ids" -> "id" buys
 * nothing and "gas" -> "ga" is the kind of damage this guard prevents.
 */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * A keyword part matches a token exactly, or — for a part of 5+ chars — as a
 * prefix whose leftover is a simple inflection, so "secret" also matches
 * "secrets" and "schedule" matches "scheduled". A short fragment can never
 * match inside an unrelated longer word: a bidirectional substring check ("rag"
 * matching "storage", "average", "drag") is exactly the false-positive class
 * this replaced, and plural folding below is not a reopening of it.
 *
 * The leftover must be an inflection, not any continuation. Otherwise
 * "experiment" would staff measurement from Node's "ExperimentalWarning",
 * which is a compiler noise token, not a measurement ask.
 *
 * Number is the one inflection compared in both directions, because a catalog
 * author's choice of singular or plural is arbitrary and should not decide
 * whether a domain fires. Folding is exact-only after singularizing; the prefix
 * rule still runs one way, so "student" reaches "students" without "st"
 * reaching anything.
 */
const PREFIX_INFLECTIONS = new Set(['s', 'es', 'ed', 'ing', 'er', 'ers']);

function prefixLeftoverIsInflection(part: string, token: string): boolean {
  if (part.length < 5 || !token.startsWith(part) || token.length <= part.length) {
    return false;
  }
  const leftover = token.slice(part.length);
  if (PREFIX_INFLECTIONS.has(leftover)) return true;
  // Silent-e stems: schedule → scheduled (leftover is "d", not "ed").
  return leftover === 'd' && part.endsWith('e');
}

function partMatches(part: string, tokens: readonly string[]): boolean {
  const partSingular = singular(part);
  return tokens.some(
    (t) => t === part || prefixLeftoverIsInflection(part, t) || singular(t) === partSingular,
  );
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
  // Split the keyword with the same tokenizer the text goes through. Splitting
  // on whitespace alone left any keyword carrying a hyphen, slash, or
  // apostrophe unmatchable forever: the text's "on-call" became the tokens
  // "on" and "call", while the keyword stayed one part spelled "on-call", and
  // a part with punctuation in it can equal no token. Such a keyword is not
  // weak, it is dead, and it fails silently — the catalog looks like it covers
  // a word it can never fire on.
  const parts = tokenize(kw);
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
  // not merely present somewhere in it. Adjacency is judged with the intent's
  // own stopwords dropped, because the parts had theirs dropped too: "hard of
  // hearing" reduces to hard+hearing, which is never literally consecutive in
  // the sentence it was written for, and a keyword that cannot reach the bonus
  // in its own best case sits under the signal floor forever.
  const significantTokens = tokens.filter((t) => !STOPWORDS.has(t));
  const runs = [tokens, significantTokens];
  const adjacent =
    parts.length === 1 ||
    runs.some((run) =>
      run.some((_, i) =>
        parts.every((p, j) => {
          const t = run[i + j];
          return t !== undefined && (t === p || (p.length >= 5 && t.startsWith(p)));
        }),
      ),
    );
  return adjacent ? 10 : 7;
}

/**
 * Which of `keywords` actually fired against `intent`, strongest first. The
 * scoring model is unchanged and unexported; this exposes the evidence behind a
 * score so a caller can say *why* something matched. Added for the implication
 * map (commitment 4: accountability is never invisible) rather than duplicating
 * the matcher there.
 */
export function matchingKeywords(
  keywords: readonly string[],
  intent: string,
): { keyword: string; score: number }[] {
  const tokens = tokenize(intent);
  return keywords
    .map((keyword) => ({ keyword, score: keywordScore(keyword, tokens) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
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
