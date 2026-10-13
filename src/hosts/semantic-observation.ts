/** Common receipt boundary for qualified native-command or host-tool reviewers.
 * No broker tool accepts these observations from a model. Adapters must establish
 * identity and held-text isolation before invoking this trusted boundary. */
import { appendActivity } from '../kernel/state/activity.ts';
import { getRun } from '../kernel/state/runs.ts';
import { heldLease } from '../kernel/state/steps.ts';
import type { StateStore } from '../kernel/state/open.ts';
import type { RefResolver } from '../kernel/project/evidence.ts';
import { readPreparedReview, reviewFreshnessProblems, semanticJudgmentProblems, type SemanticWitness, type ReviewerIdentity } from '../kernel/workflow/semantic-review.ts';

export interface SemanticReviewerAdapter {
  readonly identity: ReviewerIdentity;
  /** The host establishes a separate held-text invocation; no tool permissions are inherited. */
  review(input: { preparedRef: string; bundleDigest: string; heldText: string }): Promise<SemanticWitness>;
}
export function observeSemanticReview(input: {
  store: StateStore; witness: SemanticWitness; token: string; resolve: RefResolver;
  at: string; actor: string; metadata?: Readonly<Record<string, unknown>>;
}) {
  const prepared = readPreparedReview(input.store,input.witness.preparedRef);
  if (!prepared || prepared.digest !== input.witness.bundleDigest) throw new Error('Review observation must name the exact held evidence bundle');
  const b = prepared.bundle, run = getRun(input.store,b.runId);
  const row = input.store.db.prepare('SELECT lease_owner FROM step_runs WHERE id=?').get(b.stepRunId) as {lease_owner:string|null} | undefined;
  const lease = row?.lease_owner ? heldLease(input.store,{id:b.stepRunId,owner:row.lease_owner,nonce:input.token}) : null;
  const problems = [...input.witness.problems,...reviewFreshnessProblems(input.store,prepared,input.resolve),...semanticJudgmentProblems(b,input.witness.judgment)];
  if (!run || run.cancelRequested || !lease || lease.token !== b.attempt || lease.leaseUntil <= input.at) problems.push('Review observation lost its exact current lease');
  const identity = b.contract.reviewer, invocation = input.witness.invocation;
  const dispatched=input.store.db.prepare("SELECT payload_json FROM activity_events WHERE kind='semantic.dispatched' AND channel='host_semantic' AND run_id=? AND step_run_id=? AND json_extract(payload_json,'$.preparedRef')=? ORDER BY id DESC LIMIT 1").get(b.runId,b.stepRunId,prepared.ref) as {payload_json:string} | undefined;
  const dispatch=dispatched ? JSON.parse(dispatched.payload_json) as {id?:string;profile?:string;profileDigest?:string;binaryDigest?:string} : null;
  if (!dispatch || dispatch.id!==invocation.id || dispatch.profile!==identity?.profile || (dispatch.profileDigest ?? dispatch.binaryDigest)!==identity?.digest) problems.push('No bound adapter dispatch covers this review invocation and profile');
  if (input.witness.attempt!==b.attempt || !invocation.id?.trim() || !invocation.model?.trim()) problems.push('Review observation has an invalid attempt or invocation identity');

  if (!identity || invocation.host !== identity.host || invocation.hostVersion !== identity.version) problems.push('Review identity was not bound to this outcome');
  if (input.witness.isolation !== 'held_text' || !invocation.sessionId || invocation.sessionId === run?.sessionId) problems.push('Same-session or unisolated review cannot establish independent assurance');
  if (!invocation.completed || invocation.exitStatus !== 0 || invocation.timedOut || !invocation.transcriptDigest) problems.push('Independent review invocation did not complete');
  const receipt = { ...input.witness, problems: [...new Set(problems)] };
  const event = appendActivity(input.store,{at:input.at,kind:'semantic.executed',runId:b.runId,stepRunId:b.stepRunId,actor:input.actor,channel:'host_semantic',payload:{...input.metadata,...receipt}});
  return { reviewRef:`semantic:${event.id}`,receipt,passed:receipt.problems.length===0 };
}
