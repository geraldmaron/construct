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

import { escapeForPrompt } from '../run/sourcereads.ts';
import { relationPhrase, reverseRelationPhrase } from '../store/source-edges.ts';
import type { SourceEdge, SourceRelation } from '../store/source-edges.ts';
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
 * What moved between two snapshots of the same source, named rather than
 * summarized as "something changed" — or null when the two agree.
 *
 * The one place that sentence is composed. A watch's own finding quotes it, and
 * so does a finding about a relationship this source stands in, so a person
 * reading both reads the same account of the same change.
 */
export function sourceChangeSummary(
  prior: SourceSnapshot,
  current: SourceSnapshot,
): string | null {
  if (current.outcome === 'unreachable' && prior.outcome === 'unreachable') return null;
  if (current.outcome === 'unreachable') return current.reason;
  if (prior.outcome === 'unreachable') return `now lists ${String(current.total)} document(s)`;

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
  if (added.length === 0 && removed.length === 0 && changed.length === 0 && !totalChanged) return null;

  const parts: string[] = [];
  if (added.length > 0) parts.push(`${String(added.length)} added (${truncatedList(added)})`);
  if (removed.length > 0) parts.push(`${String(removed.length)} removed (${truncatedList(removed)})`);
  if (changed.length > 0) parts.push(`${String(changed.length)} changed size (${truncatedList(changed)})`);
  if (totalChanged && added.length === 0 && removed.length === 0) {
    parts.push(
      `the source now totals ${String(current.total)} document(s), was ${String(prior.total)}, beyond what is listed`,
    );
  }
  return parts.join('; ');
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
  const detail = sourceChangeSummary(prior, current);
  if (detail === null) return [];

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

/**
 * When a source was last seen to move, read off its own firings, or null when
 * no recorded sweep ever saw it change.
 *
 * Firings arrive oldest first and each one holds exactly what that sweep saw,
 * which is why this can be derived rather than stored: a "last changed" column
 * would be a second copy of what the snapshots already say, free to disagree
 * with them.
 */
export function lastObservedChange(
  firings: readonly { readonly firedAt: string; readonly snapshot: unknown }[],
): string | null {
  let last: string | null = null;
  for (let index = 1; index < firings.length; index += 1) {
    const before = firings[index - 1]!.snapshot as SourceSnapshot;
    const seen = firings[index]!.snapshot as SourceSnapshot;
    if (sourceChangeSummary(before, seen) !== null) last = firings[index]!.firedAt;
  }
  return last;
}

/** What is at stake when one end of each kind of relationship moves alone. */
const DIVERGENCE_STAKE: Readonly<Record<SourceRelation, string>> = {
  governs:
    'A rule and the thing held to it are no longer moving together, so what is governed may now be out of line with the rule it is measured against.',
  'depends-on':
    'One side of a declared dependency moved and the other did not, which is how something goes quietly stale while still reading as current.',
  feeds:
    'Material that feeds the other moved while what it feeds stood still, so the downstream side may rest on what the upstream no longer says.',
  supersedes:
    'A replacement and the version it replaced are drifting apart, which makes it harder for anyone to tell which of the two they are holding.',
  'covers-same-initiative':
    'Two sources declared to describe one initiative have stopped agreeing about it: one moved and the other did not.',
  contradicts:
    'Two sources already known to contradict each other have moved apart further, so the contradiction on the record is no longer the one that was declared.',
};

/**
 * What one end of a declared relationship moving alone says about the other.
 *
 * A watch over a single source can say a source changed. It cannot say the
 * change mattered, because nothing told it what else was supposed to move with
 * it. A declared relationship is exactly that missing statement, so this is
 * where "strategies quietly diverging" stops being a promise and becomes a
 * finding somebody can act on — and the finding names the relationship it came
 * from, because a reader who does not accept the relationship should not be
 * asked to accept what was derived from it.
 *
 * Raised only against evidence on both sides. The other end has to have been
 * swept since the moved end's previous sweep: a source nothing looked at has
 * not been seen to hold still, and calling that agreement would be this module
 * inventing the fact the whole finding rests on.
 */
export function edgeDivergenceFindings(input: {
  readonly edge: SourceEdge;
  /** The end this sweep saw change, and what changed about it. */
  readonly moved: Source;
  readonly detail: string;
  /** The other end, and what its own watch has recorded. */
  readonly other: Source;
  readonly otherLastSweptAt: string | null;
  readonly otherLastChangedAt: string | null;
  /** The moved end's previous sweep: the near edge of the window in question. */
  readonly since: string;
  readonly firedAt: string;
}): Finding[] {
  const { edge, moved, detail, other, otherLastSweptAt, otherLastChangedAt, since, firedAt } = input;
  if (otherLastSweptAt === null || otherLastSweptAt < since) return [];
  if (otherLastChangedAt !== null && otherLastChangedAt >= since) return [];

  // Read from the end that moved, whichever end of the declaration that is.
  const phrase =
    moved.id === edge.from ? relationPhrase(edge.relation) : reverseRelationPhrase(edge.relation);
  // The note is the user's own sentence, and a finding is read by people and
  // by models alike. It is escaped on the way in for the same reason the
  // declarations block escapes it: whether today's readers include a prompt is
  // not something this module should have to know.
  const declared =
    `declared relationship: ${sourceGroundLine(moved)} ${phrase} ${sourceGroundLine(other)}` +
    (edge.note.trim() === '' ? '' : ` — "${escapeForPrompt(edge.note.trim())}"`);
  const stillness = `${sourceGroundLine(other)} was swept at ${otherLastSweptAt} and has not changed since ${since}`;

  return [
    {
      key: `divergence:${edge.id}:${firedAt}`,
      trigger: `${sourceGroundLine(moved)} changed and ${sourceGroundLine(other)}, which it ${phrase}, did not`,
      question: `${DIVERGENCE_STAKE[edge.relation]} Does the side that stood still need to move too?`,
      branches: [
        {
          role: 'accept-as-drift',
          stance:
            'Treat the two as still in step: this change did not touch what the relationship is about, ' +
            'and the other side is right where it should be.',
          citation: `${declared}. What moved: ${detail}. ${stillness}.`,
        },
        {
          role: 'investigate',
          stance:
            'Open both and check what the relationship is supposed to hold. The side that stood still ' +
            'is the one carrying the risk, because anything resting on it is resting on the older state.',
          citation: `${declared}. What moved: ${detail}. ${stillness}.`,
        },
      ],
      wouldHaveCaught: 'evidence-provenance',
    },
  ];
}
