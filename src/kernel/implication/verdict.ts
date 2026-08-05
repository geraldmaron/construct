/**
 * implication/verdict.ts — what a user says about what surfaced, and the rules
 * that decide whether the record will take it.
 *
 * These rules lived inside the CLI's verdict command until a second surface
 * needed them: inside an MCP host is exactly where a user reacts to what
 * surfaced ("yes, legal was right to flag that"). Two copies of a labelling
 * rule is two corpora, so the rule lives here and both surfaces call it.
 *
 * The one rule worth stating: confirm and dismiss are judgments ABOUT what
 * surfaced, so they only apply to domains this run actually surfaced. A domain
 * that never surfaced cannot be confirmed or dismissed — it can only be
 * `missed`, which is the whole point of that third verdict. Accepting a
 * confirm for something that never appeared would quietly manufacture
 * agreement in the corpus the routing measurements are computed from.
 */

import { appendFeedback } from '../store/feedback.ts';
import { readWorkLog } from '../store/worklog.ts';
import type { DomainVerdict } from './harvest.ts';
import type { Store } from '../store/open.ts';

/**
 * The domains a run surfaced, read back from the work log entries `startRun`
 * wrote (run/outcome.ts's `domain-implicated` action) — the log is already the
 * record of what was inferred, so the verdict surface reads it rather than
 * keeping a second copy.
 */
export function surfacedDomains(store: Store, run: string): string[] {
  return readWorkLog(store, run)
    .filter((entry) => entry.action === 'domain-implicated')
    .map((entry) => entry.role);
}

/** The outcome text a run was started from, or null if there is no such run. */
export function runOutcomeText(store: Store, run: string): string | null {
  const entry = readWorkLog(store, run).find(
    (candidate) => candidate.action === 'outcome-received',
  );
  const detail = entry?.detail as { outcome?: unknown } | undefined;
  return typeof detail?.outcome === 'string' ? detail.outcome : null;
}

/**
 * Raised when confirm/dismiss names a domain the run never surfaced. A named
 * class rather than a bare RangeError because each surface says how to record
 * a felt absence in its own vocabulary (a CLI flag, a tool argument), and
 * sniffing the message text for that would be a rule hidden in a string.
 */
export class UnsurfacedVerdictError extends RangeError {
  readonly domains: readonly string[];
  constructor(run: string, domains: readonly string[]) {
    super(
      `${domains.join(', ')} did not surface for ${run} — ` +
        'confirm/dismiss only apply to domains this run actually surfaced.',
    );
    this.name = 'UnsurfacedVerdictError';
    this.domains = domains;
  }
}

export interface VerdictInput {
  readonly run: string;
  readonly confirm: readonly string[];
  readonly dismiss: readonly string[];
  readonly missed: readonly string[];
  /** Who is speaking: `user` from the CLI, `mcp:<client>` from a host. */
  readonly source: string;
  readonly at: string;
}

export interface RecordedVerdict {
  readonly seq: number;
  readonly confirmed: number;
  readonly dismissed: number;
  readonly missed: number;
}

/**
 * Record one verdict against a run. Throws a RangeError the caller can show
 * verbatim when there is nothing to judge or the judgment does not apply.
 */
export function recordVerdict(store: Store, input: VerdictInput): RecordedVerdict {
  const outcome = runOutcomeText(store, input.run);
  if (outcome === null) throw new RangeError(`no recorded outcome for run ${input.run}`);

  if (input.confirm.length === 0 && input.dismiss.length === 0 && input.missed.length === 0) {
    throw new RangeError('a verdict needs at least one of confirm, dismiss, or missed');
  }

  const surfaced = surfacedDomains(store, input.run);
  const unsurfaced = [...input.confirm, ...input.dismiss].filter((d) => !surfaced.includes(d));
  if (unsurfaced.length > 0) throw new UnsurfacedVerdictError(input.run, unsurfaced);

  const verdicts: Record<string, DomainVerdict> = {};
  for (const domain of input.confirm) verdicts[domain] = 'confirmed';
  for (const domain of input.dismiss) verdicts[domain] = 'dismissed';
  for (const domain of input.missed) verdicts[domain] = 'missed';

  const seq = appendFeedback(store, {
    run: input.run,
    outcome,
    verdicts,
    source: input.source,
    recordedAt: input.at,
  });

  return {
    seq,
    confirmed: input.confirm.length,
    dismissed: input.dismiss.length,
    missed: input.missed.length,
  };
}
