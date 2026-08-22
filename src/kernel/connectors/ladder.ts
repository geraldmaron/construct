/**
 * kernel/connectors/ladder.ts — running one read or one write through the
 * selection ladder `choosePath` (./seam.ts) decides between, and recording
 * on the work log which rung actually answered.
 *
 * `choosePath` is pure: given what is present, which rung answers. A real
 * caller also needs the two halves that are not pure — actually running the
 * winning rung, and writing down that it ran there rather than somewhere
 * else, which is what makes a claim's provenance auditable after the fact
 * rather than only at the moment of dispatch. This module is that wiring,
 * kept out of seam.ts because seam.ts is deliberately just the interfaces
 * and the one decision they share.
 *
 * Both the host rung and the connector rung arrive as plain function values
 * — a `ProposalApplier`/`ConnectorApply` for a write, a `ConnectorRead` for
 * a read — never as an imported host or connector module. A caller that has
 * neither passes null for that rung, which is exactly what "presence" means
 * to `choosePath`: this module never opens a connection or asks a host
 * anything on its own, so it stays as connector-free as the seam it wraps.
 */

import type { Store } from '../store/open.ts';
import { appendWorkLog } from '../store/worklog.ts';
import type { AppendWorkLog } from '../store/worklog.ts';
import { applyProposal } from '../run/apply.ts';
import type { ApplyOutcome, ProposalApplier } from '../run/apply.ts';
import type { SourceSurvey } from '../run/sourcereads.ts';
import { choosePath } from './seam.ts';
import type { ConnectorApply, ConnectorRead, PathVerdict } from './seam.ts';

/** Every write this ladder carries out is logged under this action, whichever rung answered. */
export const TRACKER_WRITE_ACTION = 'tracker-write';
/** Every read this ladder carries out is logged under this action, whichever rung answered. */
export const TRACKER_READ_ACTION = 'tracker-read';

/** Where a ladder call's work-log entry is attributed. */
export interface LadderLog {
  readonly run: string;
  readonly task?: string | null;
  readonly role: string;
  /** Injected; used both as the operation's own timestamp and the log entry's. */
  readonly at: string;
}

/**
 * The two rungs a write may run on, each already resolved to a plain
 * applier or to null. Null is what "not available" means here: a host with
 * no tracker tool and a connector nobody configured are indistinguishable
 * to this ladder from one that was never asked — presence is the caller's
 * to answer, because only the caller can know it.
 */
export interface WriteLadder {
  readonly hostApply: ProposalApplier | null;
  readonly connectorApply: ConnectorApply | null;
}

/** The two rungs a read may run on. Same presence rule as `WriteLadder`. */
export interface ReadLadder {
  readonly hostRead: ConnectorRead | null;
  readonly connectorRead: ConnectorRead | null;
}

export interface LadderApplyResult {
  readonly path: PathVerdict['path'];
  readonly evidence: PathVerdict['evidence'];
  readonly outcome: ApplyOutcome;
}

export interface LadderSurveyResult {
  readonly path: PathVerdict['path'];
  readonly evidence: PathVerdict['evidence'];
  readonly survey: SourceSurvey;
}

/** Which rung `choosePath` named, resolved to that rung's own function value — null when refused. */
function pickRung<T>(verdict: PathVerdict, host: T | null, connector: T | null): T | null {
  if (verdict.path === 'host-mcp') return host;
  if (verdict.path === 'connector') return connector;
  return null;
}

function logEntry(log: LadderLog, action: string, detail: unknown): AppendWorkLog {
  return { run: log.run, task: log.task, role: log.role, action, detail, at: log.at };
}

function applyDetail(proposal: string, verdict: PathVerdict, outcome: ApplyOutcome): Record<string, unknown> {
  return {
    proposal,
    path: verdict.path,
    evidence: verdict.evidence,
    reason: verdict.reason,
    outcome: outcome.outcome,
    ...(outcome.outcome === 'applied' ? { landed: outcome.detail } : { why: outcome.reason }),
  };
}

/**
 * Carry out one approved write through the ladder: host MCP first, the
 * configured connector when the host has none, an honest refusal when
 * neither does. Whichever rung answers, `applyProposal` (kernel/run/apply.ts)
 * still gates it on a recorded decision or standing consent — this function
 * only decides which applier reaches that gate, and writes down which one
 * did, win or refuse.
 *
 * A refusal never reaches `applyProposal` at all: there is no applier to
 * hand it, so nothing is attempted, and the reason is `choosePath`'s own —
 * stated in terms of what was actually missing (no host tool, no configured
 * connector), never a generic failure.
 */
export async function applyThroughLadder(
  store: Store,
  ladder: WriteLadder,
  proposal: string,
  log: LadderLog,
): Promise<LadderApplyResult> {
  const verdict = choosePath({
    hostMcpAvailable: ladder.hostApply !== null,
    connectorAvailable: ladder.connectorApply !== null,
  });
  const applier = pickRung(verdict, ladder.hostApply, ladder.connectorApply);

  const outcome: ApplyOutcome =
    applier === null
      ? { outcome: 'refused', reason: verdict.reason }
      : await applyProposal(store, applier, proposal, log.at);

  appendWorkLog(store, logEntry(log, TRACKER_WRITE_ACTION, applyDetail(proposal, verdict, outcome)));

  return { path: verdict.path, evidence: verdict.evidence, outcome };
}

function surveyDetail(
  source: string,
  locator: string,
  verdict: PathVerdict,
  survey: SourceSurvey,
): Record<string, unknown> {
  return {
    source,
    locator,
    path: verdict.path,
    evidence: verdict.evidence,
    reason: verdict.reason,
    outcome: survey.outcome,
    ...(survey.outcome === 'listed'
      ? { documents: survey.documents.length, total: survey.total }
      : { why: survey.reason }),
  };
}

/**
 * Survey one declared source through the ladder — the read counterpart to
 * `applyThroughLadder`. A reader that throws is read the same way a
 * connector's own read never throws — as an unreachable survey carrying the
 * error's message — because a locator that could not be read is an answer,
 * not an exception a caller has to guard against separately.
 *
 * The `source` id is stamped onto the result regardless of what the winning
 * rung's survey carried: `ConnectorRead` takes only a bare locator, and a
 * connector with no other candidate for the field (github's) sets it to the
 * locator itself — so the id this ladder was actually asked to survey
 * always wins over whatever the reader happened to set.
 */
export async function surveyThroughLadder(
  store: Store,
  ladder: ReadLadder,
  target: { readonly source: string; readonly locator: string },
  log: LadderLog,
): Promise<LadderSurveyResult> {
  const verdict = choosePath({
    hostMcpAvailable: ladder.hostRead !== null,
    connectorAvailable: ladder.connectorRead !== null,
  });
  const reader = pickRung(verdict, ladder.hostRead, ladder.connectorRead);

  let survey: SourceSurvey;
  if (reader === null) {
    survey = { source: target.source, locator: target.locator, outcome: 'unreachable', reason: verdict.reason };
  } else {
    try {
      const result = await reader(target.locator);
      survey = { ...result, source: target.source };
    } catch (error) {
      survey = {
        source: target.source,
        locator: target.locator,
        outcome: 'unreachable',
        reason: `the ${verdict.path} reader failed — ${(error as Error).message}`,
      };
    }
  }

  appendWorkLog(
    store,
    logEntry(log, TRACKER_READ_ACTION, surveyDetail(target.source, target.locator, verdict, survey)),
  );

  return { path: verdict.path, evidence: verdict.evidence, survey };
}
