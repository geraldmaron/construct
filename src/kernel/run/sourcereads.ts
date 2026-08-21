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

import { getSource, latestSourceReads, recordSourceRead, sourceReadsFor } from '../store/sources.ts';
import type { SourceRead } from '../store/sources.ts';
import type { Store } from '../store/open.ts';

/**
 * A control character inside a path — a raw newline above all — can forge a
 * new line wherever paths are joined one per line into a prompt. Every
 * printable Unicode codepoint is left alone; only the C0 and C1 control
 * codes (Unicode's own "Cc" category) count, which is exactly the range that
 * can split a line or smuggle a terminal control sequence.
 */
const UNSAFE_PATH_CHARS = /\p{Cc}/u;
/** Same class, `g`-flagged for a replace pass rather than a single test. */
const UNSAFE_PATH_CHARS_G = /\p{Cc}/gu;

export function hasUnsafePathText(value: string): boolean {
  return UNSAFE_PATH_CHARS.test(value);
}

/**
 * Render survey-derived text — a locator, a descriptor, a detail message, a
 * document path — for a prompt built by joining strings one per line. A
 * control character can reach this point no matter which layer let it
 * through, so every place a declared source or a surveyed document enters a
 * prompt renders through here rather than interpolating the raw string. The
 * escaped form is guaranteed free of bytes that could pass as a line break or
 * a terminal control sequence, at the cost of no longer being the literal
 * text underneath — the same trade the walk itself makes when it refuses to
 * list a document under an unsafe name.
 */
export function escapeForPrompt(value: string): string {
  if (!UNSAFE_PATH_CHARS.test(value)) return value;
  return value.replace(UNSAFE_PATH_CHARS_G, (ch) => {
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    if (ch === '\t') return '\\t';
    return `\\x${(ch.codePointAt(0) ?? 0).toString(16).padStart(2, '0')}`;
  });
}

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
      /**
       * How many of the unlisted documents are code, when the ranking dropped
       * any.
       *
       * "The rest went unread" reads as more of the same, and over a repository
       * it means something else entirely: a role told 60 of 3,412 documents were
       * listed has no way to know that 3,300 of the remainder are source files
       * it was never shown. That difference decides whether it goes and opens
       * one — which it is licensed to do and will not do for a gap it cannot
       * see the shape of.
       */
      readonly unlistedCode?: number;
      /**
       * Entries the walk found but withheld because their name carried a
       * control character — a raw newline above all. Counted, never listed by
       * name: an escaped rendering would still not be the literal name a host
       * needs to open the entry by, so showing one at all would offer a path
       * that reads as citable and is not. Absent or zero means the walk saw
       * nothing it had to refuse.
       */
      readonly unsafeNames?: number;
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
        '; the rest went unread' +
        (survey.unlistedCode
          ? ` — ${String(survey.unlistedCode)} of them source files, which you may still open by path`
          : ''),
      recordedAt: at,
    });
  }
  if (survey.unsafeNames) {
    // Refused, not silent: a role that never sees this row would read the
    // survey as complete when the walk actually withheld something from it.
    reads.push({
      run,
      source: survey.source,
      descriptor: survey.locator,
      coverage: 'partial',
      detail:
        `${String(survey.unsafeNames)} ${survey.unsafeNames === 1 ? 'entry' : 'entries'} in this source ` +
        `${survey.unsafeNames === 1 ? 'has' : 'have'} a name carrying a control character or newline; ` +
        'refused rather than listed, because no rendering of it is both safe ' +
        'to show and still the literal name a host could open it by',
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
 * Whether one read row is the read of an actual document, rather than the
 * source-level summary a survey adds for what it did not list one by one — a
 * capped remainder, withheld unsafe names, an unreachable locator, an empty
 * listing. That summary row's descriptor is always the source's own locator,
 * because no walk ever lists a document there, so that is what tells the two
 * apart without a field of its own.
 */
function isDocumentRead(read: Pick<SourceRead, 'descriptor'>, locator: string): boolean {
  return read.descriptor !== locator;
}

/** Complete beats partial beats unreachable — the order a coverage regression is measured against. */
const COVERAGE_RANK: Record<SourceRead['coverage'], number> = { complete: 2, partial: 1, unreachable: 0 };

/** What changed for one source between its last recorded reads and this pass's, over the document list alone. */
export interface SourceReadDelta {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /**
   * Present in both batches, but read worse this time than last — extraction
   * that used to hold now refuses, most often. The reverse direction (reads
   * better than it used to) is not named: a gap closing is not the gap this
   * exists to warn about.
   */
  readonly newlyUnreadable: readonly string[];
  /** True when neither the list nor any document's coverage moved. */
  readonly unchanged: boolean;
}

/**
 * Diff two batches of one source's read rows over the document list alone:
 * added, removed, and downgraded-in-place. Never over content — no read row
 * carries a document's bytes or a hash of them, so a path present in both
 * batches at the same coverage is left alone either way. It may hold
 * different words than it did last time; nothing here claims to know, and
 * nothing downstream should either.
 */
export function compareSourceReads(
  locator: string,
  baseline: readonly SourceRead[],
  current: readonly SourceRead[],
): SourceReadDelta {
  const before = new Map(
    baseline.filter((r) => isDocumentRead(r, locator)).map((r) => [r.descriptor, r.coverage] as const),
  );
  const after = new Map(
    current.filter((r) => isDocumentRead(r, locator)).map((r) => [r.descriptor, r.coverage] as const),
  );

  const added = [...after.keys()].filter((d) => !before.has(d)).sort();
  const removed = [...before.keys()].filter((d) => !after.has(d)).sort();
  const newlyUnreadable = [...after.keys()]
    .filter((d) => {
      const prior = before.get(d);
      const now = after.get(d);
      return prior !== undefined && now !== undefined && now !== prior && COVERAGE_RANK[now] < COVERAGE_RANK[prior];
    })
    .sort();

  return {
    added,
    removed,
    newlyUnreadable,
    unchanged: added.length === 0 && removed.length === 0 && newlyUnreadable.length === 0,
  };
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

/** One source's comparison against its own read history: whether it had any, and what changed if so. */
export interface SourceReadComparison {
  readonly source: string;
  /** False when this pass is the first recorded read of this source. */
  readonly hasBaseline: boolean;
  /** When the prior batch was recorded, so a message can say since when. Null with no baseline. */
  readonly baselineAt: string | null;
  readonly delta: SourceReadDelta;
}

/**
 * Compare this pass's reads against each source's own last recorded pass,
 * then record this pass so the next one has it to compare against in turn.
 * Comparison happens first, before any of this pass's rows are written —
 * fetching every baseline before recording anything is what keeps a source
 * from ever being compared against itself. There is no baseline kept apart
 * from the record; the append-only rows already on file are the only place
 * one lives.
 */
export function compareAndRecordSourceReads(
  store: Store,
  run: string,
  surveys: readonly SourceSurvey[],
  at: string,
): SourceReadComparison[] {
  const comparisons = surveys.map((survey) => {
    const declared = getSource(store, survey.source);
    const locator = declared?.locator ?? survey.locator;
    const baseline = latestSourceReads(store, survey.source);
    const current = readsFromSurvey(run, survey, at);
    return {
      source: survey.source,
      hasBaseline: baseline.length > 0,
      baselineAt: baseline[0]?.recordedAt ?? null,
      delta: compareSourceReads(locator, baseline, current),
    };
  });
  recordRunSourceReads(store, run, surveys, at);
  return comparisons;
}
