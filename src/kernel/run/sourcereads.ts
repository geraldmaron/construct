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

/**
 * What became of a binary document the survey tried to put into words. A
 * document nothing can extract is a real answer and stays on the record with
 * the ladder's own reason: the failure mode this replaces is a directory of
 * PDFs grounding a run in filenames while reading as covered.
 */
export type DocumentExtraction =
  | {
      readonly outcome: 'extracted';
      /** Which ladder rung produced the text. */
      readonly tier: string;
      /** Where the extracted text was materialized, for a role to open. */
      readonly path: string;
      readonly characters: number;
    }
  | {
      readonly outcome: 'refused';
      readonly reason: string;
      readonly remediation: string | null;
    };

/** One document a survey found, by the path a role will cite and open. */
export interface SurveyedDocument {
  readonly path: string;
  readonly bytes: number;
  /** Present and true for a document the walk could not read as text. */
  readonly binary?: boolean;
  /**
   * Present only when extraction was asked for and the document needed it.
   * Absent means nobody tried, which reads differently from tried and failed.
   */
  readonly extraction?: DocumentExtraction;
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
      /**
       * How the walk ranked what it found, when the cap made the ranking
       * matter. Recorded on the partial row so a role reading "the rest went
       * unread" can tell which rest: prose-first drops the code, code-first
       * drops the prose, and the two are different gaps.
       */
      readonly emphasis?: string;
    }
  | {
      readonly source: string;
      readonly locator: string;
      readonly outcome: 'unreachable';
      readonly reason: string;
    };

/**
 * How completely one listed document was actually read, and the honest detail
 * behind that verdict. Plain text is complete because the role can open it.
 * A binary document is complete only once a rung has put it into words at a
 * path the role can open; refused and unattempted both stay partial, because
 * a file the walk saw but nobody read is material the role does not have.
 */
function documentCoverage(doc: SurveyedDocument): Pick<SourceRead, 'coverage' | 'detail'> {
  if (!doc.binary) {
    return { coverage: 'complete', detail: `${String(doc.bytes)} bytes` };
  }
  const extraction = doc.extraction;
  if (extraction?.outcome === 'extracted') {
    return {
      coverage: 'complete',
      detail:
        `${String(doc.bytes)} bytes, binary — extracted by ${extraction.tier} to ` +
        `${extraction.path} (${String(extraction.characters)} characters); read the ` +
        'extraction, cite the original',
    };
  }
  if (extraction?.outcome === 'refused') {
    return {
      coverage: 'partial',
      detail:
        `${String(doc.bytes)} bytes, binary — extraction refused: ${extraction.reason}` +
        (extraction.remediation ? `; ${extraction.remediation}` : ''),
    };
  }
  return {
    coverage: 'partial',
    detail:
      `${String(doc.bytes)} bytes, binary — listed, not extracted; ` +
      "read it with your host's own tools if you can, and treat its " +
      'content as unknown otherwise',
  };
}

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
    ...documentCoverage(doc),
    recordedAt: at,
  }));
  if (survey.total > survey.documents.length) {
    reads.push({
      run,
      source: survey.source,
      descriptor: survey.locator,
      coverage: 'partial',
      detail:
        `listed ${String(survey.documents.length)} of ${String(survey.total)} documents` +
        (survey.emphasis ? `, ranked ${survey.emphasis}-first` : '') +
        '; the rest went unread',
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
