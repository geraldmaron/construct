import { assertLeasePaths } from '../work/lanes.ts';
import { runExecutionProblems } from '../workflow/verification.ts';
/** A managed run's requested local artifact already has an admitted purpose.
 * Reserve it with the step, instead of asking the host to invent another
 * outcome/statement and a second coordination sequence before delivery.
 */
import { relative, resolve, posix } from 'node:path';
import { lstatSync } from 'node:fs';
import type { WorkflowStep } from '../registry/models.ts';
import { getRun } from '../state/runs.ts';
import type { BrokerContext } from './context.ts';
import type { WorkPacket } from '../workflow/service.ts';
import { askedOf } from '../workflow/asked.ts';
import { appendActivity } from '../state/activity.ts';
import { listDeliverables } from '../state/deliverables.ts';
import { expireDeadLeases, listSteps } from '../state/steps.ts';
import { createWork, getWork, claimWork, takeoverWork, associateRun, completeWork, releaseWork, cancelWork } from '../work/service.ts';
import { findOverlaps, MAIN_LANE, normalizeLeasePath } from '../work/leases.ts';
import { contentReceipt } from '../workflow/verification.ts';
import { projectResolver } from '../source/resolver.ts';

const identity = (runId: string) => `work-${runId}-delivery`;
const owner = (ctx: BrokerContext) => ctx.sessionId ? `${ctx.sessionId}/main` : ctx.actor;
// The system owns this specific reservation; public work reads deliberately hide secrets.
function reservationToken(ctx: BrokerContext, id: string): string | undefined {
  return (ctx.store.db.prepare('SELECT claim_token FROM work_items WHERE id = ? AND claim_owner = ?').get(id, owner(ctx)) as { claim_token: string | null } | undefined)?.claim_token ?? undefined;
}

/** Only observed ended/dead sessions may expire a still-live step lease. */
export function recoverAbandonedSteps(ctx: BrokerContext, runId?: string): number {
  const at = ctx.now();
  return ctx.store.transaction(() => {
    const steps = ctx.store.db.prepare("SELECT id, run_id, lease_owner, lease_until, attempts FROM step_runs WHERE state = 'leased' AND lease_until > ? AND (? IS NULL OR run_id = ?)").all(at, runId ?? null, runId ?? null) as { id: string; run_id: string; lease_owner: string; lease_until: string; attempts: number }[];
    let recovered = 0;
    for (const step of steps) {
      const bound = ctx.store.db.prepare("SELECT payload_json FROM activity_events WHERE kind = 'step.session_bound' AND step_run_id = ? ORDER BY id DESC LIMIT 1").get(step.id) as { payload_json: string } | undefined;
      const binding = bound ? JSON.parse(bound.payload_json) as { owner?: string; attempt?: number; sessionId?: string } : null;
      const session = binding?.owner === step.lease_owner && binding.attempt === step.attempts && binding.sessionId
        ? ctx.store.db.prepare('SELECT id, ended_at, pid, machine FROM sessions WHERE id = ?').get(binding.sessionId)
        : ctx.store.db.prepare("SELECT id, ended_at, pid, machine FROM sessions WHERE 'session:' || host || ':' || id = ?").get(step.lease_owner);
      const holder = session as { id: string; ended_at: string | null; pid: number | null; machine: string } | undefined;
      if (!holder || holder.id === ctx.sessionId || (!holder.ended_at && !(holder.pid !== null && ctx.processAlive?.(holder.pid, holder.machine) === false))) continue;
      const changed = ctx.store.db.prepare("UPDATE step_runs SET lease_until = ? WHERE id = ? AND state = 'leased' AND lease_owner = ? AND attempts = ? AND lease_until = ?").run(at, step.id, step.lease_owner, step.attempts, step.lease_until).changes;
      if (changed) {
        recovered += 1;
        appendActivity(ctx.store, { at, kind: 'step.holder_ended', runId: step.run_id, stepRunId: step.id, actor: 'kernel', payload: { sessionId: holder.id, owner: step.lease_owner, attempt: step.attempts, evidence: holder.ended_at ? 'session ended' : 'adapter observed process absent' } });
      }
    }
    if (recovered) expireDeadLeases(ctx.store, at, runId);
    return recovered;
  });
}

/** Artifact spelling and reservation scope are different: ordinary filenames
 * may contain spaces, while published reservation identifiers remain plain. */
function artifactPath(root: string, ref: string): string {
  const path = relative(root, resolve(root, ref));
  if (/\p{C}/u.test(path)) throw new Error('an artifact path cannot contain control characters');
  return normalizeLeasePath(path, 'check');
}

function reservationPath(path: string): string {
  let candidate = path;
  for (;;) {
    try { return normalizeLeasePath(candidate); }
    catch {
      const parent = posix.dirname(candidate);
      if (parent === '.') return '/';
      candidate = `${parent}/`;
    }
  }
}

interface Holder { id: string; ended_at: string | null; pid: number | null; machine: string }
function holderState(ctx: BrokerContext, id: string | null): 'ended' | 'absent' | 'live' | 'unknown' {
  if (!id || id === ctx.sessionId) return id ? 'live' : 'unknown';
  const holder = ctx.store.db.prepare('SELECT id, ended_at, pid, machine FROM sessions WHERE id = ?').get(id) as Holder | undefined;
  if (!holder) return 'unknown';
  if (holder.ended_at) return 'ended';
  const alive = holder.pid === null ? null : ctx.processAlive?.(holder.pid, holder.machine);
  return alive === false ? 'absent' : alive === true ? 'live' : 'unknown';
}
function boundSession(ctx: BrokerContext, step: { id: string; leaseOwner: string | null; attempts: number }): string | null {
  const row = ctx.store.db.prepare("SELECT payload_json FROM activity_events WHERE kind = 'step.session_bound' AND step_run_id = ? ORDER BY id DESC LIMIT 1").get(step.id) as { payload_json: string } | undefined;
  const binding = row ? JSON.parse(row.payload_json) as { owner?: string; attempt?: number; sessionId?: string } : null;
  if (binding?.owner === step.leaseOwner && binding.attempt === step.attempts && binding.sessionId) return binding.sessionId;
  return (ctx.store.db.prepare("SELECT id FROM sessions WHERE 'session:' || host || ':' || id = ?").get(step.leaseOwner) as { id: string } | undefined)?.id ?? null;
}

interface DeliveryRecovery { kind: 'delivery_recovery'; requestedRunId: string; priorRunId: string; workId: string; path: string; holder: string; reasons: readonly string[]; checkpoint: ReturnType<typeof contentReceipt>; next: string }
export class DeliveryRecoveryRequired extends Error {
  readonly recovery: DeliveryRecovery;
  constructor(recovery: DeliveryRecovery) {
    super(recovery.next);
    this.name = 'DeliveryRecoveryRequired';
    this.recovery = recovery;
  }
}

/** A newer manual request may replace abandoned preparation, never an attempt
 * that entered a writing tier or has an existing artifact/action to reconcile.
 * Called only inside the claim transaction: all state moves roll back together.
 */
function recoverPriorPreparation(ctx: BrokerContext, packet: WorkPacket, path: string): { runId: string; workId: string; evidence: string }[] {
  const at = ctx.now(), recovered: { runId: string; workId: string; evidence: string }[] = [];
  const reservedPath = reservationPath(path);
  const collisions = findOverlaps(ctx.store, { paths: [reservedPath], laneRoot: ctx.lane?.root ?? MAIN_LANE, now: at, excludeWorkId: identity(packet.run.id) }).filter(o => o.kind === 'collision');
  for (const collision of collisions) {
    const item = getWork(ctx.store, collision.workId), scope = item?.scope as { kind?: string; runId?: string; path?: string } | null;
    const prior = scope?.runId ? getRun(ctx.store, scope.runId) : null;
    if (!item || !prior || scope?.kind !== 'managed_delivery' || identity(prior.id) !== item.id) continue; // ordinary reservations retain their existing conflict contract
    const reasons: string[] = [], state = holderState(ctx, item.claimSession);
    const checkpoint = contentReceipt(path, projectResolver(ctx.store, ctx.root), 'artifact');
    const creation = (id: string) => (ctx.store.db.prepare("SELECT id FROM activity_events WHERE kind = 'run.created' AND run_id = ? ORDER BY id LIMIT 1").get(id) as { id: number } | undefined)?.id;
    const oldOrder = creation(prior.id), newOrder = creation(packet.run.id);
    const admitted = ctx.store.db.prepare("SELECT id FROM activity_events WHERE kind = 'work.admitted' AND actor = 'kernel' AND run_id = ? AND json_extract(payload_json, '$.basis') = 'existing_managed_run' AND json_extract(payload_json, '$.workId') = ? LIMIT 1").get(prior.id, item.id);
    const associated = ctx.store.db.prepare("SELECT 1 FROM work_runs WHERE work_id = ? AND run_id = ? AND role = 'implements'").get(item.id, prior.id);
    const held = ctx.store.db.prepare('SELECT path, lane_root FROM path_leases WHERE work_id = ? AND released_at IS NULL').all(item.id) as { path: string; lane_root: string }[];
    const oldDestination = askedOf(prior).intake?.destination;
    if (!admitted || !associated) reasons.push('the reservation has no matching kernel admission and run association');
    if (scope.path !== path || collision.heldPath !== reservedPath || held.length !== 1 || held[0]?.path !== reservedPath || held[0]?.lane_root !== (ctx.lane?.root ?? MAIN_LANE) || oldDestination?.kind !== 'project_file' || !oldDestination.ref || artifactPath(ctx.root, oldDestination.ref) !== path) reasons.push('the reservation is not the same exact file in this checkout');
    if (!oldOrder || !newOrder || oldOrder >= newOrder) reasons.push('this request is not a newer run than the reserved preparation');
    if (prior.workflowId !== packet.run.workflowId || prior.workflowDigest !== packet.run.workflowDigest) reasons.push('the workflows or frozen definitions differ');
    if (prior.triggerKind !== 'manual' || packet.run.triggerKind !== 'manual' || prior.executorKind !== 'interactive' || packet.run.executorKind !== 'interactive' || packet.run.executorId !== ctx.host.executorId) reasons.push('automatic replacement requires a new manual interactive request in this session');
    if (!['ended', 'absent'].includes(state)) reasons.push('the reservation holder is live or its termination is unknown; quiet alone is insufficient');
    if ((ctx.store.db.prepare('SELECT handoff_json FROM work_items WHERE id = ?').get(item.id) as { handoff_json: string | null }).handoff_json) reasons.push('an explicit handoff must be honored');
    if (['succeeded', 'failed', 'cancelled'].includes(prior.state)) reasons.push('the prior terminal run needs explicit settlement');
    const steps = listSteps(ctx.store, prior.id), bindings = (prior.bindings as { steps?: readonly WorkflowStep[] } | null)?.steps;
    const readCapabilities = new Set(['read_project_context', 'read_project_files', 'read_source', 'model_review', 'ask_user']);
    if (!bindings || steps.some(s => {
      const definition = bindings.find(b => b.id === s.stepId);
      return s.attempts > 0 && (!['observe', 'draft'].includes(s.permissionTier) || !definition || definition.capabilities.some(c => !readCapabilities.has(c)));
    })) reasons.push('a prior attempted step had writing or action capability; recover that run without replaying effects');
    if (steps.filter(s => s.state === 'leased').some(s => !['ended', 'absent'].includes(holderState(ctx, boundSession(ctx, s))))) reasons.push('an outstanding step has a live or unknown holder');
    if (ctx.store.db.prepare("SELECT 1 FROM activity_events WHERE run_id = ? AND (kind LIKE 'verification.%' OR kind LIKE 'delegation.%' OR kind LIKE 'action.%') LIMIT 1").get(prior.id) || ctx.store.db.prepare('SELECT 1 FROM work_items WHERE parent_id = ? LIMIT 1').get(item.id)) reasons.push('recorded execution or child work needs explicit reconciliation');
    let fileState: 'absent' | 'present' | 'unknown' = 'present';
    try { lstatSync(resolve(ctx.root, path)); } catch (error) { fileState = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unknown'; }
    if (fileState !== 'absent' || checkpoint.digest !== null) reasons.push('an existing or unreadable artifact must be reconciled through the prior run');
    if (reasons.length) throw new DeliveryRecoveryRequired({ kind: 'delivery_recovery', requestedRunId: packet.run.id, priorRunId: prior.id, workId: item.id, path, holder: state, reasons, checkpoint, next: `No new step or reservation was granted. Preserve the artifact and prior run. Inspect run_status for ${prior.id}; resume it with claim_work only after its holder ended or its lease expires, or honor its explicit handoff. Reconcile any prior actions before cancelling/replanning. Do not repeat start_outcome or claim a second commitment for this path.` });
    recoverAbandonedSteps(ctx, prior.id);
    expireDeadLeases(ctx.store, at, prior.id);
    const reason = `Newer manual run ${packet.run.id} replaces preparation after ${state} holder; no recorded writing/action attempt or artifact is present.`;
    const taken = takeoverWork(ctx.store, { id: item.id, owner: owner(ctx), session: ctx.sessionId ?? undefined, agent: 'main', lane: ctx.lane?.root, branch: ctx.lane?.branch ?? null, now: at, until: packet.leased.leaseUntil, reason, processAlive: ctx.processAlive, quietCapMs: Number.POSITIVE_INFINITY });
    const cancelled = ctx.workflow.cancel({ runId: prior.id, by: 'kernel', reason });
    if (cancelled.state !== 'cancelled') throw new Error('abandoned preparation did not fully cancel; preserve its reservation');
    cancelWork(ctx.store, { id: taken.id, actor: owner(ctx), token: taken.claimToken, at, reason });
    appendActivity(ctx.store, { at, kind: 'delivery.preparation_superseded', runId: packet.run.id, actor: 'kernel', channel: 'kernel', payload: { priorRunId: prior.id, workId: item.id, path, holderState: state, checkpoint, reason } });
    recovered.push({ runId: prior.id, workId: item.id, evidence: state });
  }
  return recovered;
}

export function reserveManagedDelivery(ctx: BrokerContext, packet: WorkPacket) {
  const at = ctx.now();
  if (ctx.sessionId) appendActivity(ctx.store, { at, kind: 'step.session_bound', runId: packet.run.id, stepRunId: packet.leased.id, actor: 'kernel', payload: { owner: packet.leased.leaseOwner, attempt: packet.leased.token, sessionId: ctx.sessionId } });
  const destination = askedOf(packet.run).intake?.destination;
  if (destination?.kind !== 'project_file' || !destination.ref) return null;
  const path = artifactPath(ctx.root, destination.ref);
  const reservedPath = reservationPath(path);
  assertLeasePaths({ root: ctx.root, lane: ctx.lane?.root, paths: [path, reservedPath], store: ctx.store, now: at });
  if (path === '/' || path.endsWith('/')) throw new Error('a managed artifact destination must name a project file');
  const recoveredPreparation = recoverPriorPreparation(ctx, packet, path);
  const id = identity(packet.run.id), claimant = owner(ctx);
  let item = getWork(ctx.store, id);
  if (!item) {
    item = createWork(ctx.store, { id, kind: 'task', title: `Deliver ${path}`, description: `Coordinate the requested local artifact of managed run ${packet.run.id}. This does not admit a statement or grant any additional action tier.`, scope: { kind: 'managed_delivery', runId: packet.run.id, path }, acceptance: ['The existing managed run succeeds with its requested local artifact held and verified at its actual assurance level.'], status: 'open', at, actor: 'kernel' });
    associateRun(ctx.store, { workId: id, runId: packet.run.id, role: 'implements', at });
    appendActivity(ctx.store, { at, kind: 'work.admitted', runId: packet.run.id, actor: 'kernel', payload: { workId: id, basis: 'existing_managed_run', path } });
  }
  const scope = item.scope as { kind?: string; runId?: string; path?: string } | null;
  if (scope?.kind !== 'managed_delivery' || scope.runId !== packet.run.id || scope.path !== path) throw new Error('managed delivery coordination identity conflicts with existing work');
  const who = { owner: claimant, session: ctx.sessionId ?? undefined, agent: 'main', lane: ctx.lane?.root, branch: ctx.lane?.branch ?? null };
  if (item.status === 'claimed' && item.claimOwner !== claimant && item.claimUntil && item.claimUntil > at) {
    item = takeoverWork(ctx.store, { id, ...who, now: at, until: packet.leased.leaseUntil, reason: 'Resume this same managed delivery after its previous session ended.', processAlive: ctx.processAlive, quietCapMs: Number.POSITIVE_INFINITY });
  }
  const held = claimWork(ctx.store, { id, ...who, now: at, until: packet.leased.leaseUntil, token: item.claimOwner === claimant ? reservationToken(ctx, id) : undefined, paths: [reservedPath] });
  const draft = packet.step.tier === 'project_write' ? listDeliverables(ctx.store, packet.run.id).at(-1) : undefined;
  const prepared = draft ? { ref: `deliverable:${draft.id}`, body: JSON.stringify(draft.body).length <= 64000 ? draft.body : undefined, omitted: JSON.stringify(draft.body).length > 64000, next: 'Use this held draft as input to the requested file; an omitted body is available through run_status.' } : null;
  return { workId: id, path, reservedPath, prepared, recoveredPreparation, owner: claimant, claimUntil: held.claimUntil, checkpoint: contentReceipt(path, projectResolver(ctx.store, ctx.root), 'artifact'), next: `${reservedPath === path ? '' : `The containing repository scope ${JSON.stringify(reservedPath)} is reserved conservatively for this filename. `}This run already reserves the requested file. Do not create a second outcome, remember a new commitment, or repeat work claim for this path. Write/checkpoint the artifact during the first allowed project-write step, then submit its reference. A reservation does not widen the step tier or accept the result.` };
}

export function settleManagedDelivery(ctx: BrokerContext, runId: string, state: string): void {
  if (!['succeeded', 'failed', 'cancelled', 'blocked', 'waiting_for_decision'].includes(state)) return;
  const item = getWork(ctx.store, identity(runId));
  if (!item || item.status !== 'claimed' || item.claimOwner !== owner(ctx)) return;
  const scope = item.scope as { kind?: string; runId?: string } | null;
  if (scope?.kind !== 'managed_delivery' || scope.runId !== runId) return;
  const token = reservationToken(ctx, item.id);
  if (!token) throw new Error('managed delivery reservation lost its claim secret');
  if (state === 'succeeded' && runExecutionProblems(ctx.store, runId, projectResolver(ctx.store, ctx.root)).length) return;
  if (state === 'succeeded') completeWork(ctx.store, { id: item.id, owner: item.claimOwner, token, at: ctx.now(), resolveEvidence: projectResolver(ctx.store, ctx.root), reason: 'The managed run completed its required checks and requested artifact. This records delivery, not human acceptance or universal semantic verification.' });
  else releaseWork(ctx.store, { id: item.id, owner: item.claimOwner, token, at: ctx.now() });
}
