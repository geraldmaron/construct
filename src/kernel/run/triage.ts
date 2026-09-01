/**
 * kernel/run/triage.ts — inbound tracker issues read for likely duplicates,
 * as write proposals under the same two risk tiers every other proposal
 * carries (kernel/run/proposals.ts's WriteAction/riskOfAction).
 *
 * Construct holds no live tracker transport yet, so the issues triaged here arrive
 * the same way a live tracker read already does for reconcile
 * (cli/reconcile.ts's --live): handed in by the caller, never fetched by
 * this module. The reading itself is mechanical — no model call, and
 * re-running it over the same issues proposes the same rows rather than
 * doubling the queue, the same property run/proposals.ts's extraction gets
 * from deriving its ids off what it read rather than off when it ran.
 *
 * A later issue whose title shares enough significant words with an earlier
 * one is likely the same report filed twice. "Likely" only ever produces the
 * annotation class: labelling and commenting on the later issue are both
 * reversible by anyone who reads them, so both are low risk and both are
 * fair game for a workspace's standing consent (kernel/store/sources.ts).
 * Closing the later issue is not reversible the same way — a closed issue
 * reads as settled — so that proposal is filed only where the titles match
 * outright once normalized, and even then it is high risk and waits for a
 * person, the same as any other update.
 *
 * The earlier issue in a pair is always read as the canonical one: nothing
 * in an issue's own fields says which of two reports of the same bug was
 * filed first, so the order issues arrive in is taken as that order, the
 * same assumption kernel/store/sources.ts's own "oldest first" listing makes.
 */

import { createHash } from 'node:crypto';
import type { WriteAction } from './proposals.ts';
import { riskOfAction } from './proposals.ts';

export interface TrackerIssue {
  readonly id: string;
  readonly title: string;
}

export interface DuplicateMatch {
  readonly issue: TrackerIssue;
  readonly canonical: TrackerIssue;
  /** Fraction of the two titles' significant words held in common. */
  readonly similarity: number;
  /** Whether the titles matched outright once normalized, not merely closely. */
  readonly exact: boolean;
}

/**
 * Below this fraction of shared title words, two issues are read as
 * unrelated rather than possibly the same report. Set so two titles sharing
 * most of their meaningful words match (a rewritten summary of the same bug)
 * while two that merely share one or two common terms do not.
 */
export const DUPLICATE_THRESHOLD = 0.6;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'in', 'on', 'of', 'for', 'and', 'or', 'is', 'are',
  'was', 'were', 'it', 'this', 'that', 'with', 'when', 'at', 'be', 'not',
]);

function titleWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word));
  return new Set(words);
}

/** The fraction of two titles' significant words held in common (Jaccard). */
export function titleSimilarity(a: string, b: string): number {
  const wordsA = titleWords(a);
  const wordsB = titleWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared += 1;
  const union = wordsA.size + wordsB.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Every issue matched against each strictly earlier one, in input order,
 * stopping at the first that clears DUPLICATE_THRESHOLD. An issue is never
 * matched against a later one, so a match's canonical side is always the
 * earlier of the two and a chain of near-identical issues collapses onto the
 * first of them rather than pairing up in a line.
 */
export function findDuplicates(issues: readonly TrackerIssue[]): readonly DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (let i = 1; i < issues.length; i += 1) {
    const issue = issues[i]!;
    for (let j = 0; j < i; j += 1) {
      const canonical = issues[j]!;
      const similarity = titleSimilarity(issue.title, canonical.title);
      if (similarity >= DUPLICATE_THRESHOLD) {
        matches.push({ issue, canonical, similarity, exact: similarity === 1 });
        break;
      }
    }
  }
  return matches;
}

export interface TriageProposal {
  readonly id: string;
  readonly source: string;
  readonly change: string;
  readonly justification: string;
  readonly risk: 'low' | 'high';
  readonly action: WriteAction;
}

export interface TriageInput {
  /** The declared source these issues were read from. */
  readonly source: string;
  /** How that source reads to a person deciding — its locator. */
  readonly locator: string;
  readonly issues: readonly TrackerIssue[];
}

export interface Triage {
  readonly proposals: readonly TriageProposal[];
  readonly matches: readonly DuplicateMatch[];
}

function slug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'issue';
}

/**
 * A row's id, derived from what it proposes rather than from when triage ran
 * — the same reason kernel/run/proposals.ts's docEditId hashes its inputs
 * instead of stamping a time: proposing the same change to the same issue
 * twice reaches the row already waiting rather than doubling the queue. The
 * slug keeps the id readable; the digest is what actually guarantees two
 * different issue ids can never collide once slugged.
 */
function rowId(source: string, issue: string, action: WriteAction): string {
  const digest = createHash('sha256').update([source, issue, action].join(' ')).digest('hex').slice(0, 8);
  return `wp-triage-${slug(source)}-${slug(issue)}-${action}-${digest}`;
}

function pct(similarity: number): string {
  return `${String(Math.round(similarity * 100))}%`;
}

/**
 * Duplicate matches read as write proposals: always a label and a comment on
 * the later issue (low risk — standing-consent territory), and only where
 * the titles matched outright, an update proposing to close it as a
 * duplicate (high risk — a person's call).
 */
export function triageProposals(input: TriageInput): Triage {
  const matches = findDuplicates(input.issues);
  const proposals: TriageProposal[] = [];

  for (const match of matches) {
    const { issue, canonical, similarity, exact } = match;
    const justification =
      `duplicate detection: ${issue.id} ("${issue.title}") shares ${pct(similarity)} of its ` +
      `title's significant words with ${canonical.id} ("${canonical.title}")`;

    proposals.push({
      id: rowId(input.source, issue.id, 'label'),
      source: input.source,
      change: `label issue ${issue.id} in ${input.locator}: possible-duplicate`,
      justification,
      risk: riskOfAction('label'),
      action: 'label',
    });
    proposals.push({
      id: rowId(input.source, issue.id, 'comment'),
      source: input.source,
      change:
        `comment on issue ${issue.id} in ${input.locator}: this looks like a duplicate of ` +
        `${canonical.id} — "${canonical.title}"`,
      justification,
      risk: riskOfAction('comment'),
      action: 'comment',
    });
    if (exact) {
      proposals.push({
        id: rowId(input.source, issue.id, 'update'),
        source: input.source,
        change: `update issue ${issue.id} in ${input.locator}: close as a duplicate of ${canonical.id}`,
        justification,
        risk: riskOfAction('update'),
        action: 'update',
      });
    }
  }

  return { proposals, matches };
}
