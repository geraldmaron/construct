/**
 * cli/survey.ts — the CLI's side of a survey: where extracted text is put,
 * how a workspace's declared sources are walked, and the three views a drift
 * pass needs of the result.
 *
 * Walking is filesystem work, so it lives out here rather than in the kernel;
 * what the walk is worth — recorded reads, licensed roots, the log entry that
 * says it happened — is kernel/run/groundpass.ts, which takes the walk as an
 * argument.
 */

import { join } from 'node:path';
import { resolvePaths } from '../kernel/paths.ts';
import type { Store } from '../kernel/store/open.ts';
import { sourceShape } from '../kernel/store/sources.ts';
import type { Source } from '../kernel/store/sources.ts';
import type { SourceSurvey } from '../kernel/run/sourcereads.ts';
import type { SourceSurveyor } from '../kernel/run/groundpass.ts';
import type { ProducerSource } from '../kernel/context/produce.ts';
import type { DocumentWords } from '../kernel/context/observations.ts';
import { documentWords, surveySource } from '../hosts/sources.ts';
import { probeDocling } from '../hosts/extract.ts';

/**
 * Where extracted text is materialized. Under the cache root rather than the
 * user's ground: an extraction is a rendering Construct produced, and writing
 * it into the directory the user declared would put Construct's output inside
 * its own evidence.
 */
function extractionCacheRoot(): string {
  return join(resolvePaths().cacheDir, 'extractions');
}

/**
 * Survey a set of declared sources, extracting whatever the walk could not
 * read. The one place a survey is asked for, so every surface that grounds
 * itself — a run's dispatch, a drift pass over a workspace — sees the same
 * documents, extracted the same way, with one Docling probe between them.
 */
export function surveyDeclared(store: Store, sources: readonly Source[]): SourceSurvey[] {
  if (sources.length === 0) return [];
  const extract = { cacheRoot: extractionCacheRoot(), docling: probeDocling() };
  return sources.map((source) => {
    // A source nobody shaped is surveyed the way every source was before the
    // setting existed, so declaring nothing keeps today's behavior exactly.
    const shape = sourceShape(store, source.id);
    return surveySource(source, {
      extract,
      ...(shape ? { emphasis: shape.emphasis, cap: shape.cap } : {}),
    });
  });
}

/** This CLI's own walk of a workspace's declared sources, handed to the kernel pass. */
export function surveyor(store: Store): SourceSurveyor {
  return (sources) => surveyDeclared(store, sources);
}

/**
 * The three views a drift pass needs of the same survey: what the producer is
 * shown, what the screen checks its citations against, and the words those
 * documents actually hold so a quotation can be located in one. Built together
 * so the model can never be shown one set of documents and graded on another.
 */
export function driftGround(
  sources: readonly Source[],
  surveys: readonly SourceSurvey[],
): {
  readonly producerSources: ProducerSource[];
  readonly surveyed: Map<string, Set<string>>;
  readonly words: DocumentWords;
} {
  const bySource = new Map(surveys.map((s) => [s.source, s]));
  const surveyed = new Map<string, Set<string>>();
  const producerSources = sources.map((source) => {
    const survey = bySource.get(source.id);
    const base = { id: source.id, kind: source.kind, locator: source.locator };
    if (!survey || survey.outcome !== 'listed') {
      return { ...base, documents: [], unreachable: survey?.reason ?? 'no survey was taken' };
    }
    const documents = survey.documents.map((d) => d.path);
    surveyed.set(source.id, new Set(documents));
    return { ...base, documents };
  });
  return { producerSources, surveyed, words: documentWords(surveys) };
}
