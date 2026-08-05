/**
 * kernel/verify/claims.ts — tier-1 deterministic no-fabrication check.
 * A load-bearing claim (money amount, percentage, ISO date, numeric duration,
 * statute reference) in a deliverable must carry a citation marker
 * `[cite:...]` or an explicit `[unverified]` tag on the same line. Runs
 * without a model, so it holds identically on every host and every model
 * family.
 *
 * Scope decision for legal deliverables. A recorded first-run deliverable
 * consisted almost entirely of statutory citations ("Polish Labour Code
 * art. 22 §1(1)", "Directive 2011/7") and deadline claims ("must be reported
 * within 72 hours of awareness"), and this check saw none of them: on legal
 * work the challenge was theatre. Those two shapes are numeric-anchored and
 * deterministic, so they belong in this tier and are matched below — but only
 * in the forms the recorded deliverable actually used (art./arts. plus a
 * number, § plus a number, Directive n/n, a number with a time unit). Widening
 * beyond observed shapes would be tuning a matcher against text invented to
 * fit it, which validates nothing.
 *
 * Deliberately NOT matched here: bare quantities ("three of the five fields")
 * and statute forms no real deliverable has produced. Spelled-out numbers
 * saturate ordinary prose; flagging them teaches every role to sprinkle
 * [unverified] until the matcher is quiet, which destroys the tag's meaning.
 * Whether a cited statute actually supports the claim made on it is not
 * checkable without reading the statute — that is the substantive model-run
 * legal pass's job, not this tier's.
 */

export interface UntaggedClaim {
  readonly line: number;
  readonly text: string;
}

const CLAIM =
  /(\$[\d][\d,.]*|\b\d+(?:\.\d+)?%|\b\d{4}-\d{2}-\d{2}\b|\b\d+(?:\.\d+)?\s*(?:business\s+)?(?:hour|day|week|month|year)s?\b|\barts?\.\s*\d+|§\s*\d+|\bDirective\s+\d+\/\d+)/i;
const TAG = /\[(cite:[^\]]+|unverified)\]/i;

/**
 * A citation whose body is a source file rather than a source.
 *
 * A role dispatched with ambient filesystem access and no material of its own
 * reaches for whatever is nearest and cites it. Observed on a real run: an
 * employment-law question answered by reading the tool's own package, citing a
 * module of keyword definitions as the authority. Nothing about the deliverable
 * looked wrong — it looked cited, which is worse than looking uncited, because
 * a citation is the unit of trust here.
 *
 * The pattern deliberately catches paths and not filenames-in-prose. "See
 * agreement.pdf" from the user's own material is a legitimate thing to cite; a
 * path with a directory separator and a code extension is the tool's insides or
 * the user's repository, and neither is evidence about a domain.
 */
const SOURCE_PATH = /\[cite:[^\]]*[\w)\]]?[/\\][^\]]*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|rs|json|lock)\b[^\]]*\]/i;

export interface MisplacedCitation {
  readonly line: number;
  readonly text: string;
}

/**
 * Citations that point at code rather than at a source for the claim.
 *
 * Reported separately from untagged claims because the two failures need
 * different words: one deliverable did not source its claim, the other sourced
 * it to something that cannot support it.
 */
export function findSourceFileCitations(text: string): MisplacedCitation[] {
  const findings: MisplacedCitation[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (SOURCE_PATH.test(line)) findings.push({ line: i + 1, text: line.trim() });
  }
  return findings;
}

export function findUntaggedClaims(text: string): UntaggedClaim[] {
  const findings: UntaggedClaim[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (CLAIM.test(line) && !TAG.test(line)) {
      findings.push({ line: i + 1, text: line.trim() });
    }
  }
  return findings;
}
