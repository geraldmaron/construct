/**
 * kernel/implication/harvest.ts — every real run is a labeling event
 *.
 *
 * The scarcest input to measuring the implication map is honestly-labeled
 * outcomes. All three committed corpora are dead in the specific sense
 * RESEARCH-DECISIONS.md §1 documents: one shares an author with the catalog,
 * one was tuned against until it stopped being held out, one was burned by
 * being committed. Authoring more repeats the pattern — the corpus is not too
 * small so much as too used.
 *
 * But from Phase 2 on, the system generates labels as a byproduct of running.
 * The user sees which domains surfaced, dismisses the wrong ones, and is
 * ambushed by the missed ones. Each of those is a verdict from someone who is
 * not the catalog's author, on the deployed distribution rather than an
 * author's guess at it — and yesterday's runs are always unspent with respect
 * to today's catalog, which converts "burned on commit" from a terminal state
 * into a renewable one.
 *
 * This module is the pure core of that loop: verdict records in, corpus
 * outcomes out, in exactly the fixture shape map.test.ts already consumes.
 * Storage and CLI wiring live with the store and the spine; a verdict's
 * provenance travels with it because a corpus whose labels cannot say where
 * they came from is how the last one died.
 */

/** What actually happened to one domain in one run, per the user. */
export type DomainVerdict =
  /** Surfaced, and the user let it run: an implicit yes. */
  | 'confirmed'
  /** Surfaced, and the user dismissed it: a no from the deployed distribution. */
  | 'dismissed'
  /** Never surfaced, and its absence was later felt: the ambush the product exists to prevent. */
  | 'missed';

export interface ImplicationFeedback {
  /** The outcome text exactly as the user stated it. */
  readonly outcome: string;
  /** Verdicts by domain name. Domains with no verdict carry no information. */
  readonly verdicts: Readonly<Record<string, DomainVerdict>>;
  /** Who rendered the verdicts — never the catalog's author for corpus use. */
  readonly source: string;
  /** Injected, like every timestamp in the kernel. ISO 8601. */
  readonly recordedAt: string;
  /** Optional stratification category, matching the corpus quota fields. */
  readonly category?: string;
}

/** A corpus outcome in the exact shape the fixtures and map.test.ts use. */
export interface HarvestedOutcome {
  readonly id: string;
  readonly category: string;
  readonly outcome: string;
  readonly expect: readonly string[];
  /** Where the labels came from. The committed corpora died for lack of this. */
  readonly provenance: {
    readonly source: string;
    readonly recordedAt: string;
    /** Domains the user explicitly rejected — negative labels, which no authored corpus has. */
    readonly rejected: readonly string[];
  };
}

/**
 * Fold one run's feedback into a corpus outcome.
 *
 * `expect` is what the user's verdicts say the outcome genuinely implicates:
 * the confirmed surfacings plus the felt absences. Dismissals become explicit
 * negative labels rather than mere absence — an authored corpus cannot
 * distinguish "not implicated" from "the author didn't think of it", and this
 * is the one place the distinction is captured at the moment it is knowable.
 *
 * Returns null for feedback carrying no verdicts: an outcome nobody judged is
 * not a labeled outcome, and admitting it would relabel silence as data.
 */
export function harvestOutcome(
  feedback: ImplicationFeedback,
  id: string,
): HarvestedOutcome | null {
  const entries = Object.entries(feedback.verdicts);
  if (entries.length === 0) return null;
  if (!feedback.outcome.trim()) return null;

  const expect: string[] = [];
  const rejected: string[] = [];
  for (const [domain, verdict] of entries) {
    if (verdict === 'confirmed' || verdict === 'missed') expect.push(domain);
    else if (verdict === 'dismissed') rejected.push(domain);
    else throw new RangeError(`unknown verdict "${String(verdict)}" for domain "${domain}"`);
  }
  expect.sort();
  rejected.sort();

  return {
    id,
    category: feedback.category ?? 'uncategorized',
    outcome: feedback.outcome,
    expect,
    provenance: {
      source: feedback.source,
      recordedAt: feedback.recordedAt,
      rejected,
    },
  };
}

export interface HarvestedCorpus {
  readonly note: string;
  readonly discipline: string;
  readonly outcomes: readonly HarvestedOutcome[];
  /** Feedback records that carried no verdicts, counted rather than silently dropped. */
  readonly skipped: number;
}

/**
 * Fold a run history into a corpus document, fixture-shaped.
 *
 * Ids are positional (`r1`, `r2`, ...) in input order, so the same history
 * always harvests to the same corpus — determinism is what lets a harvested
 * corpus be diffed across catalog versions, which is the entire point.
 */
export function harvestCorpus(history: readonly ImplicationFeedback[]): HarvestedCorpus {
  const outcomes: HarvestedOutcome[] = [];
  let skipped = 0;
  let n = 0;
  for (const feedback of history) {
    n += 1;
    const harvested = harvestOutcome(feedback, `r${n}`);
    if (harvested) outcomes.push(harvested);
    else skipped += 1;
  }
  return {
    note:
      'Harvested from real runs: every label is a user verdict ' +
      'rendered at run time, not an author guess. Provenance travels with each outcome.',
    discipline:
      'Never tune against outcomes whose verdicts postdate the catalog change being ' +
      'evaluated. A harvested corpus is spent per catalog version, not forever: ' +
      'yesterday\'s runs are unspent with respect to today\'s edits.',
    outcomes,
    skipped,
  };
}
