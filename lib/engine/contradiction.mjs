/**
 * lib/engine/contradiction.mjs — deterministic "do these two observations disagree?"
 *
 * Restatement supersede collapses near-duplicates that say the
 * same thing. The open case is contradiction: two observations about the same
 * subject that make opposing claims ("auth is supported" vs "auth is not
 * supported"). A contradiction inherently shares most of its tokens but flips
 * one — so its cosine sits *below* the duplicate threshold, which is why the
 * consolidation scan looks in a suspicious band rather than inside a cluster.
 *
 * The signal this detects without an LLM is negation polarity: same claim
 * words, opposite assertion. A value swap with no negation cue ("RS256" vs
 * "HS256") is not caught here — that needs semantic judgment and is left to an
 * optional `contradictionJudge` plugin wired into the consolidation pass.
 */

// Cues that flip an assertion. Apostrophes are stripped during tokenization, so
// contracted forms appear here without them (don't -> dont, isn't -> isnt).
const NEGATION_CUES = new Set([
  'not', 'no', 'never', 'none', 'neither', 'nor', 'without', 'cannot',
  'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent', 'wont',
  'cant', 'couldnt', 'shouldnt', 'wouldnt', 'fails', 'failing', 'failed',
  'unsupported', 'disabled', 'broken', 'missing', 'absent',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Decide whether two observation texts contradict on negation polarity.
 *
 * Contradiction = the claim words (tokens minus negation cues) overlap heavily
 * AND the two carry a different number of negation cues — one asserts, the other
 * denies the same thing.
 *
 * @param {string} textA
 * @param {string} textB
 * @param {{coreSimilarity?: number}} [opts] coreSimilarity: Jaccard floor on the
 *   cue-stripped token sets (default 0.6); below it the two are about different
 *   subjects, not a flipped claim.
 * @returns {{contradicts: boolean, coreSimilarity: number, negDelta: number, reason: string}}
 */
export function detectContradiction(textA, textB, opts = {}) {
  const floor = opts.coreSimilarity ?? 0.6;
  const tokA = tokenize(textA);
  const tokB = tokenize(textB);
  const negA = tokA.filter((t) => NEGATION_CUES.has(t)).length;
  const negB = tokB.filter((t) => NEGATION_CUES.has(t)).length;
  const coreA = new Set(tokA.filter((t) => !NEGATION_CUES.has(t)));
  const coreB = new Set(tokB.filter((t) => !NEGATION_CUES.has(t)));

  const coreSimilarity = jaccard(coreA, coreB);
  const negDelta = negA - negB;
  const contradicts =
    coreA.size > 0 && coreB.size > 0 &&
    coreSimilarity >= floor &&
    negDelta !== 0;

  return { contradicts, coreSimilarity, negDelta, reason: 'negation-polarity' };
}

export const __testing = { tokenize, jaccard, NEGATION_CUES };
