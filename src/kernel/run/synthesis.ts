/**
 * kernel/run/synthesis.ts — merge the run's role deliverables into one issue
 * list. Deliverables carry numbered issues (the coordinator's work product
 * directive demands them), so synthesis is extraction plus a merge of
 * near-duplicates across roles, keeping every role's attribution on the
 * merged issue.
 *
 * The merge is lexical and says so: token overlap, no model, no judgment
 * about which phrasing was better — the first role to raise an issue keeps
 * the wording, later roles add their names. A lexical merge will sometimes
 * keep two phrasings of one issue apart; that is the honest failure mode:
 * both phrasings are shown, and nothing is silently lost.
 */

/** One numbered issue as a role's deliverable stated it. */
export interface SpottedIssue {
  readonly role: string;
  readonly text: string;
}

/** A merged issue: one wording, every role that raised it. */
export interface MergedIssue {
  readonly text: string;
  readonly roles: readonly string[];
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'its', 'no', 'not', 'of', 'on', 'or', 'that', 'the', 'this',
  'to', 'with', 'we', 'you', 'your', 'cannot', 'must', 'should', 'will',
]);

function significantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/** Jaccard overlap of significant tokens; 1 is identical vocabulary, 0 disjoint. */
export function issueOverlap(a: string, b: string): number {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Two issues in different words are the same issue at this overlap or above.
 * Chosen to catch restatements ("email storage needs a retention policy" vs
 * "a retention policy for stored emails is missing") while keeping genuinely
 * different issues in the same vocabulary apart; steered by verdicts if it
 * proves wrong, not asserted as truth.
 */
export const MERGE_THRESHOLD = 0.5;

/**
 * Pull the numbered issues out of one deliverable's text. An issue is a line
 * starting `1.` or `1)` and its continuation lines up to the next number,
 * blank line, or heading. A deliverable with no numbered lines contributes no
 * issues — that absence is visible in the synthesis rather than invented.
 */
export function extractIssues(role: string, deliverable: string): SpottedIssue[] {
  const issues: SpottedIssue[] = [];
  let current: string[] | null = null;
  for (const line of deliverable.split('\n')) {
    const start = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (start) {
      if (current) issues.push({ role, text: current.join(' ').trim() });
      current = [start[1] ?? ''];
    } else if (current) {
      const trimmed = line.trim();
      if (trimmed === '' || /^#+\s/.test(trimmed) || /^[A-Z-]+:/.test(trimmed)) {
        issues.push({ role, text: current.join(' ').trim() });
        current = null;
      } else {
        current.push(trimmed);
      }
    }
  }
  if (current) issues.push({ role, text: current.join(' ').trim() });
  return issues.filter((i) => i.text !== '');
}

/**
 * Merge issues across roles. Order is preserved from the input — the first
 * role to raise an issue anchors it — and a later near-duplicate adds its
 * role to the anchor instead of appearing again.
 */
export function mergeIssues(issues: readonly SpottedIssue[]): MergedIssue[] {
  const merged: Array<{ text: string; roles: string[] }> = [];
  for (const issue of issues) {
    const anchor = merged.find((m) => issueOverlap(m.text, issue.text) >= MERGE_THRESHOLD);
    if (anchor) {
      if (!anchor.roles.includes(issue.role)) anchor.roles.push(issue.role);
    } else {
      merged.push({ text: issue.text, roles: [issue.role] });
    }
  }
  return merged.map((m) => ({ text: m.text, roles: m.roles }));
}

/** The full pass: extract from every deliverable, merge across roles. */
export function synthesizeIssues(
  deliverables: ReadonlyArray<{ readonly role: string; readonly text: string }>,
): MergedIssue[] {
  return mergeIssues(deliverables.flatMap((d) => extractIssues(d.role, d.text)));
}
