/**
 * kernel/run/groundpass.ts — the producer half of grounding for one run.
 *
 * Walking a locator is filesystem work and stays outside (hosts/sources.ts);
 * what lives here is everything the walk is for — which sources the run's plan
 * declared, recording what was read against the run, and logging that the
 * reads happened. The surveyor is injected for the same reason a connector is:
 * the kernel says what a survey is worth, never how to take one.
 */

import type { Store } from '../store/open.ts';
import { planFor } from '../store/plans.ts';
import { getSource } from '../store/sources.ts';
import type { Source } from '../store/sources.ts';
import { appendWorkLog } from '../store/worklog.ts';
import { recordRunSourceReads } from './sourcereads.ts';
import type { SourceSurvey } from './sourcereads.ts';

/** What a set of declared sources actually holds, taken however the caller can. */
export type SourceSurveyor = (sources: readonly Source[]) => readonly SourceSurvey[];

export interface GroundingPass {
  readonly surveys: readonly SourceSurvey[];
  readonly recorded: number;
  /** True when the run already had reads and this pass wrote nothing. */
  readonly skipped: boolean;
  readonly documents: number;
  readonly unreachable: number;
  readonly extracted: number;
}

/**
 * The producer half of grounding for one run: survey every declared source,
 * put its unreadable documents into words, record what was read, and log it.
 *
 * One function because `outcome --answer` and `work` were doing this
 * identically in two places, and two copies of a grounding pass is two
 * chances for a run to be graded against ground it was never licensed.
 * Recording is once per run — the read record is evidence, not a cache — so a
 * second pass reports skipped and writes nothing.
 */
export function groundRun(
  store: Store,
  run: string,
  at: string,
  survey: SourceSurveyor,
): GroundingPass | null {
  const plan = planFor(store, run);
  if (!plan || plan.sourcesDeclared.length === 0) return null;

  const declared = plan.sourcesDeclared
    .map((id) => getSource(store, id))
    .filter((s): s is Source => s !== null && s !== undefined);
  const surveys = survey(declared);

  const { recorded, skipped } = recordRunSourceReads(store, run, surveys, at);
  const listed = surveys.filter((s) => s.outcome === 'listed');
  const documents = listed.reduce((sum, s) => sum + s.documents.length, 0);
  const extracted = listed.reduce(
    (sum, s) => sum + s.documents.filter((d) => d.extraction?.outcome === 'extracted').length,
    0,
  );
  const pass: GroundingPass = {
    surveys,
    recorded,
    skipped,
    documents,
    unreachable: surveys.length - listed.length,
    extracted,
  };
  if (skipped) return pass;

  appendWorkLog(store, {
    run,
    role: 'construct',
    action: 'sources-read',
    detail: {
      sources: surveys.length,
      documents,
      unreachable: pass.unreachable,
      extracted,
      reads: recorded,
      // Licensed vs listed, on the record: the listed documents are the read
      // rows; the roots are what the roles may read past them.
      licensedRoots: listed.map((s) => s.locator).sort(),
    },
    at,
  });
  return pass;
}

/** The one-line grounding summary both survey surfaces print. */
export function groundingSummary(pass: GroundingPass): string {
  return (
    `${String(pass.documents)} document${pass.documents === 1 ? '' : 's'} ` +
    `from ${String(pass.surveys.length)} source${pass.surveys.length === 1 ? '' : 's'}` +
    (pass.extracted > 0 ? `, ${String(pass.extracted)} extracted` : '') +
    (pass.unreachable > 0 ? ` (${String(pass.unreachable)} unreachable)` : '')
  );
}
