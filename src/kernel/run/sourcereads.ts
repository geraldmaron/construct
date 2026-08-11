/**
 * kernel/run/sourcereads.ts — turning a survey of declared ground into a run's
 * read record: the producer half of grounding.
 *
 * The store records reads and the coordinator consumes them; this module is
 * the judgment between a survey and the rows. Who reads a declared source is
 * settled here the way routing was settled: the kernel lists what the ground
 * actually holds and hands the role the named documents; the content is read
 * through the host's own tools, because Construct builds no connectors and
 * never stands between a host and its model. What the kernel owns is the
 * honest record — a source that could not be listed appears saying so, a
 * listing cut short appears as partial, and an empty directory appears as a
 * complete read of nothing, so no silence downstream can pass as coverage.
 *
 * Pure judgment: the walking, statting, and failing happen in hosts/sources.ts
 * and arrive here as a declared SourceSurvey, which is what makes every
 * coverage decision testable without a filesystem.
 */

import { getSource, recordSourceRead, sourceReadsFor } from '../store/sources.ts';
import type { SourceRead } from '../store/sources.ts';
import type { Store } from '../store/open.ts';

/** One document a survey found, by the path a role will cite and open. */
export interface SurveyedDocument {
  readonly path: string;
  readonly bytes: number;
}

/**
 * What actually sits at a declared source's locator, as gathered by the IO
 * half. `total` counts every matching document, listed or not, so a cap is
 * visible as the difference rather than silently absorbed.
 */
export type SourceSurvey =
  | {
      readonly source: string;
      readonly locator: string;
      readonly outcome: 'listed';
      readonly documents: readonly SurveyedDocument[];
      readonly total: number;
    }
  | {
      readonly source: string;
      readonly locator: string;
      readonly outcome: 'unreachable';
      readonly reason: string;
    };

/**
 * The rows one survey earns. Listed documents each get a complete read row —
 * the descriptor is the path exactly as the role must cite it. A survey that
 * listed fewer documents than exist adds a partial row for the remainder, and
 * an unreachable survey is one row saying so: both are material the role must
 * know it does not have, and the assignment's gap warning keys off them.
 */
export function readsFromSurvey(run: string, survey: SourceSurvey, at: string): SourceRead[] {
  if (survey.outcome === 'unreachable') {
    return [
      {
        run,
        source: survey.source,
        descriptor: survey.locator,
        coverage: 'unreachable',
        detail: survey.reason,
        recordedAt: at,
      },
    ];
  }
  const reads: SourceRead[] = survey.documents.map((doc) => ({
    run,
    source: survey.source,
    descriptor: doc.path,
    coverage: 'complete' as const,
    detail: `${String(doc.bytes)} bytes`,
    recordedAt: at,
  }));
  if (survey.total > survey.documents.length) {
    reads.push({
      run,
      source: survey.source,
      descriptor: survey.locator,
      coverage: 'partial',
      detail:
        `listed ${String(survey.documents.length)} of ${String(survey.total)} documents; ` +
        'the rest went unread',
      recordedAt: at,
    });
  }
  if (reads.length === 0) {
    // An empty directory read completely is an answer, not an absence: without
    // this row the source would be indistinguishable from one never surveyed.
    reads.push({
      run,
      source: survey.source,
      descriptor: survey.locator,
      coverage: 'complete',
      detail: 'no readable documents found',
      recordedAt: at,
    });
  }
  return reads;
}

/**
 * The local roots a run's roles are licensed to read beyond the listed
 * documents. Derived from the read record, never from the declarations alone:
 * a source whose every read row is unreachable licenses nothing, because a
 * root nobody could survey is a root the citation gate cannot vouch for.
 */
export function groundRootsFor(store: Store, run: string): string[] {
  const reachable = new Set(
    sourceReadsFor(store, run)
      .filter((read) => read.coverage !== 'unreachable')
      .map((read) => read.source),
  );
  const roots: string[] = [];
  for (const id of reachable) {
    const source = getSource(store, id);
    if (source && (source.kind === 'directory' || source.kind === 'git')) {
      roots.push(source.locator);
    }
  }
  return roots.sort();
}

export interface RecordedReads {
  readonly recorded: number;
  /** True when the run already had reads and nothing was written. */
  readonly skipped: boolean;
}

/**
 * Record what a run's declared sources hold, once. A run that already has
 * reads keeps them: re-surveying on every `work` invocation would let a file
 * that moved between invocations silently rewrite what the first dispatch was
 * grounded in, and the record is evidence, not a cache.
 */
export function recordRunSourceReads(
  store: Store,
  run: string,
  surveys: readonly SourceSurvey[],
  at: string,
): RecordedReads {
  if (sourceReadsFor(store, run).length > 0) {
    return { recorded: 0, skipped: true };
  }
  let recorded = 0;
  for (const survey of surveys) {
    for (const read of readsFromSurvey(run, survey, at)) {
      recordSourceRead(store, read);
      recorded += 1;
    }
  }
  return { recorded, skipped: false };
}
