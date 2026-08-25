/**
 * kernel/render/redact.ts — the credential boundary: how text Construct did not
 * write is stripped of anything shaped like a live secret before it is stored
 * or shown.
 *
 * A host is spawned with the operator's whole ambient environment, so every
 * provider key sitting in that shell is in the child's environment too. A
 * verbose authentication failure prints those keys back on stderr, and stderr
 * is captured onto the error record and later shown on screen. A connector's
 * error body is the same kind of text from the other direction — whatever a
 * remote returned, kept verbatim so a reader learns why a call was refused.
 * Both are text nobody here authored, and both can carry a credential.
 *
 * So the rule mirrors the one kernel/render/terminal.ts holds for control
 * bytes: neutralize at the boundary rather than trust the person downstream.
 * A token-shaped run is replaced with a fixed placeholder; everything else is
 * returned untouched, because a redaction that ate ordinary error prose would
 * cost a reader the one thing the record is for — the reason a call failed.
 *
 * WHAT NEVER GOES THROUGH HERE. Construct's own strings. Redacting them would
 * be a no-op on today's text and a licence to stop distinguishing tomorrow's;
 * the call at a capture site is what marks that text as somebody else's words.
 */

/** What a redacted run is replaced with. One fixed shape, so a reader learns nothing about what was there. */
export const REDACTION_PLACEHOLDER = '[redacted]';

/**
 * Known credential shapes, most-specific first. Each is a published prefix a
 * real key of that provider carries, so a match here is a near-certain secret
 * rather than a guess. The generic heuristic below is the backstop for a shape
 * not named here; these exist so the common providers are caught by their own
 * signature, whatever their length or entropy.
 */
const KNOWN_SHAPES: readonly RegExp[] = [
  // A PEM private-key block, header through footer, across the lines between.
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
  // Anthropic and OpenAI: sk-ant-… is a longer sk-… so one pattern covers both.
  /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  // Atlassian API token — the shape CONSTRUCT_JIRA_API_TOKEN takes.
  /ATATT3[A-Za-z0-9_=.-]{20,}/g,
  // AWS access key id.
  /AKIA[0-9A-Z]{16}/g,
  // GitHub tokens: personal (ghp_), server (ghs_), OAuth (gho_), user/refresh.
  /gh[posur]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  // Slack bot and user tokens.
  /xox[bpars]-[A-Za-z0-9-]{10,}/g,
  // Google API key.
  /AIza[0-9A-Za-z_-]{35}/g,
];

/** A run long enough and mixed enough to be worth weighing as a token rather than a word. */
const TOKEN_CANDIDATE = /[A-Za-z0-9+/=_-]{24,}/g;

/** Shannon entropy per character, in bits — high for a random token, low for a word. */
function entropyPerChar(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Whether one long run reads as a random token rather than as ordinary text.
 * Conservative on purpose: a run has to be long, carry both a digit and a
 * letter, and be high-entropy before it is taken for a secret. Ordinary words
 * — even long ones — carry no digit and never clear this bar, so the reason a
 * call failed survives while a leaked key does not.
 */
function looksLikeToken(run: string): boolean {
  if (!/[0-9]/.test(run) || !/[A-Za-z]/.test(run)) return false;
  return entropyPerChar(run) >= 3.5;
}

/**
 * Strip anything shaped like a live credential from host- or connector-derived
 * text, leaving everything else exactly as it was. Applied to a child's stderr
 * before it is stored on an error record, and to a connector's error body
 * before the same — the two places text nobody here wrote becomes part of the
 * record a person reads.
 */
export function redact(value: string): string {
  let out = value;
  for (const shape of KNOWN_SHAPES) out = out.replace(shape, REDACTION_PLACEHOLDER);
  out = out.replace(TOKEN_CANDIDATE, (run) => (looksLikeToken(run) ? REDACTION_PLACEHOLDER : run));
  return out;
}
