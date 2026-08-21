/**
 * kernel/watch/source-ground.ts — turning two structural snapshots of a
 * declared source into watch findings.
 *
 * construct-ground.ts turns a tracker/repo reconcile report into findings;
 * this is the same shape of translation for ground outside Construct's own
 * repository. What changed is read structurally — which documents exist, how
 * large they are, whether the source can be reached at all — never by asking
 * a model to characterize the change, so a watch with no host named never
 * pays for one. Naming a host on the declaration is recorded for whatever
 * reviews the finding next; this module always compares structurally and
 * never calls a host itself.
 *
 * A finding here is not framed the way a drift finding is, because there is
 * no tracker asserting anything to be right or wrong — the source simply
 * moved. What a person needs is the same regardless: what changed, named
 * rather than summarized as "something changed", and a reversible default
 * stated as plainly as every other watch's.
 */

import type { Source } from '../store/sources.ts';
import type { SourceSurvey } from '../run/sourcereads.ts';
import type { Finding } from './watch.ts';

/** One document as a watch remembers it: enough to say what changed, not what it says. */
export interface SourceDocumentSnapshot {
  readonly path: string;
  readonly bytes: number;
  readonly binary: boolean;
}

/**
 * What one sweep saw, compact enough to store and compare. Deliberately drops
 * everything about extraction and ranking: a watch does not read documents,
 * so a document's rung or whether the cap ranked it first is not a fact this
 * comparison needs.
 */
export type SourceSnapshot =
  | {
      readonly outcome: 'listed';
      readonly total: number;
      readonly documents: readonly SourceDocumentSnapshot[];
    }
  | { readonly outcome: 'unreachable'; readonly reason: string };

/** The structural facts of a survey, sorted so two surveys of the same ground compare equal. */
export function snapshotFromSurvey(survey: SourceSurvey): SourceSnapshot {
  if (survey.outcome === 'unreachable') return { outcome: 'unreachable', reason: survey.reason };
  return {
    outcome: 'listed',
    total: survey.total,
    documents: survey.documents
      .map((d) => ({ path: d.path, bytes: d.bytes, binary: d.binary === true }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Ground worth naming, so a watch's own outcome text reads like one. */
export function sourceGroundLine(source: Source): string {
  return `${source.kind} source at ${source.locator}`;
}

function truncatedList(paths: readonly string[], max = 8): string {
  if (paths.length <= max) return paths.join(', ');
  return `${paths.slice(0, max).join(', ')}, +${String(paths.length - max)} more`;
}

function reachabilityFinding(
  source: Source,
  firedAt: string,
  becameUnreachable: boolean,
  detail: string,
): Finding {
  return {
    key: `reachability:${firedAt}`,
    trigger: becameUnreachable
      ? `${sourceGroundLine(source)} became unreachable`
      : `${sourceGroundLine(source)} became reachable again`,
    question: becameUnreachable
      ? 'The source this watch follows can no longer be read. Did it move, or is this a real removal?'
      : 'The source this watch follows can be read again. Is what it holds now still what it held before?',
    branches: [
      {
        role: 'accept-as-drift',
        stance: becameUnreachable
          ? 'Treat the outage as transient; the next sweep says whether it persists.'
          : 'Treat the ground as trustworthy again; this sweep does not check what happened during the outage.',
        citation: detail,
      },
      {
        role: 'investigate',
        stance: becameUnreachable
          ? 'A source that stops resolving is worth checking before anything cites it as current.'
          : 'A source back after being unreachable may hold different material than what was last read from it.',
        citation: detail,
      },
    ],
    wouldHaveCaught: 'evidence-provenance',
  };
}

/**
 * What changed between two snapshots of the same source, or nothing when
 * they agree. `prior` is null on a watch's first-ever firing: there is
 * nothing yet to compare against, so that firing establishes the baseline
 * quietly, the same way a watch's first sweep never raises anything.
 *
 * At most one finding: every distinct sweep-with-a-change is its own
 * decision (`key` carries `firedAt`, so it is never mistaken for a standing
 * finding already in the inbox), but one sweep bundles everything it saw
 * into one call for a person to make, rather than flooding the inbox with
 * one decision per changed document.
 */
export function sourceWatchFindings(input: {
  readonly source: Source;
  readonly prior: SourceSnapshot | null;
  readonly current: SourceSnapshot;
  /** Distinguishes this sweep's finding from every other sweep's; the firing time. */
  readonly firedAt: string;
}): Finding[] {
  const { source, prior, current, firedAt } = input;
  if (prior === null) return [];
  if (current.outcome === 'unreachable' && prior.outcome === 'unreachable') return [];
  if (current.outcome === 'unreachable') {
    return [reachabilityFinding(source, firedAt, true, current.reason)];
  }
  if (prior.outcome === 'unreachable') {
    return [
      reachabilityFinding(source, firedAt, false, `now lists ${String(current.total)} document(s)`),
    ];
  }

  // Both snapshots are 'listed' here, narrowed by the two returns above.
  const priorDocs = new Map(prior.documents.map((d) => [d.path, d] as const));
  const currentDocs = new Map(current.documents.map((d) => [d.path, d] as const));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [path, doc] of currentDocs) {
    const before = priorDocs.get(path);
    if (!before) added.push(path);
    else if (before.bytes !== doc.bytes || before.binary !== doc.binary) changed.push(path);
  }
  for (const path of priorDocs.keys()) {
    if (!currentDocs.has(path)) removed.push(path);
  }
  const totalChanged = prior.total !== current.total;
  if (added.length === 0 && removed.length === 0 && changed.length === 0 && !totalChanged) return [];

  const parts: string[] = [];
  if (added.length > 0) parts.push(`${String(added.length)} added (${truncatedList(added)})`);
  if (removed.length > 0) parts.push(`${String(removed.length)} removed (${truncatedList(removed)})`);
  if (changed.length > 0) parts.push(`${String(changed.length)} changed size (${truncatedList(changed)})`);
  if (totalChanged && added.length === 0 && removed.length === 0) {
    parts.push(
      `the source now totals ${String(current.total)} document(s), was ${String(prior.total)}, beyond what is listed`,
    );
  }
  const detail = parts.join('; ');

  return [
    {
      key: `changed:${firedAt}`,
      trigger: `${sourceGroundLine(source)} changed since the last watch`,
      question: 'Ground this watch follows has moved. Does anything grounded in the old state need a second look?',
      branches: [
        {
          role: 'accept-as-drift',
          stance:
            'Treat this as expected upkeep of the source; nothing here says any deliverable cites the changed material.',
          citation: detail,
        },
        {
          role: 'investigate',
          stance:
            'Open the source and check whether a role cited the part that changed — a citation into moved material points at something that no longer says what it did.',
          citation: detail,
        },
      ],
      wouldHaveCaught: 'evidence-provenance',
    },
  ];
}
