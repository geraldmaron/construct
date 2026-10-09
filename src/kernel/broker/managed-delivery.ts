/** A managed run's requested local artifact already has an admitted purpose.
 * Reserve it with the step, instead of asking the host to invent another
 * outcome/statement and a second coordination sequence before delivery.
 */
import { relative, resolve } from 'node:path';
import type { BrokerContext } from './context.ts';
import type { WorkPacket } from '../workflow/service.ts';
import { askedOf } from '../workflow/asked.ts';
import { appendActivity } from '../state/activity.ts';
import { listDeliverables } from '../state/deliverables.ts';
import { expireDeadLeases } from '../state/steps.ts';
import { createWork, getWork, claimWork, takeoverWork, associateRun, completeWork, releaseWork } from '../work/service.ts';
import { normalizeLeasePath } from '../work/leases.ts';
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

export function reserveManagedDelivery(ctx: BrokerContext, packet: WorkPacket) {
  const at = ctx.now();
  if (ctx.sessionId) appendActivity(ctx.store, { at, kind: 'step.session_bound', runId: packet.run.id, stepRunId: packet.leased.id, actor: 'kernel', payload: { owner: packet.leased.leaseOwner, attempt: packet.leased.token, sessionId: ctx.sessionId } });
  const destination = askedOf(packet.run).intake?.destination;
  if (destination?.kind !== 'project_file' || !destination.ref) return null;
  const path = normalizeLeasePath(relative(ctx.root, resolve(ctx.root, destination.ref)));
  if (path === '/' || path.endsWith('/')) throw new Error('a managed artifact destination must name a project file');
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
    item = takeoverWork(ctx.store, { id, ...who, now: at, until: packet.leased.leaseUntil, reason: 'Resume this same managed delivery after its previous session ended.', processAlive: ctx.processAlive });
  }
  const held = claimWork(ctx.store, { id, ...who, now: at, until: packet.leased.leaseUntil, token: item.claimOwner === claimant ? reservationToken(ctx, id) : undefined, paths: [path] });
  const draft = packet.step.tier === 'project_write' ? listDeliverables(ctx.store, packet.run.id).at(-1) : undefined;
  const prepared = draft ? { ref: `deliverable:${draft.id}`, body: JSON.stringify(draft.body).length <= 64000 ? draft.body : undefined, omitted: JSON.stringify(draft.body).length > 64000, next: 'Use this held draft as input to the requested file; an omitted body is available through run_status.' } : null;
  return { workId: id, path, prepared, owner: claimant, claimUntil: held.claimUntil, checkpoint: contentReceipt(path, projectResolver(ctx.store, ctx.root)), next: 'This run already reserves the requested file. Do not create a second outcome, remember a new commitment, or repeat work claim for this path. Write/checkpoint the artifact during the first allowed project-write step, then submit its reference. A reservation does not widen the step tier or accept the result.' };
}

export function settleManagedDelivery(ctx: BrokerContext, runId: string, state: string): void {
  if (!['succeeded', 'failed', 'cancelled', 'blocked', 'waiting_for_decision'].includes(state)) return;
  const item = getWork(ctx.store, identity(runId));
  if (!item || item.status !== 'claimed' || item.claimOwner !== owner(ctx)) return;
  const scope = item.scope as { kind?: string; runId?: string } | null;
  if (scope?.kind !== 'managed_delivery' || scope.runId !== runId) return;
  const token = reservationToken(ctx, item.id);
  if (!token) throw new Error('managed delivery reservation lost its claim secret');
  if (state === 'succeeded') completeWork(ctx.store, { id: item.id, owner: item.claimOwner, token, at: ctx.now(), reason: 'The managed run completed its required checks and requested artifact. This records delivery, not human acceptance or universal semantic verification.' });
  else releaseWork(ctx.store, { id: item.id, owner: item.claimOwner, token, at: ctx.now() });
}
