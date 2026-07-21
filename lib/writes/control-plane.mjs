/**
 * lib/writes/control-plane.mjs — the sole governed-write chokepoint
 * (construct-b0nny.15, M2): the only entry point that turns a queued
 * writeIntent into an executed write (LMCP-J6).
 *
 * A specialist (in-process, embed-invoked, or MCP-invoked) may only ever
 * *recommend* a write: it produces a writeIntent (lib/writes/write-intent.mjs)
 * and hands it to an ApprovalQueue (lib/embed/approval-queue.mjs, the F5/I2
 * durable queue). Nothing else in this file, nor anywhere outside it, is
 * permitted to resolve a governed-write adapter and call
 * lib/writes/envelope.mjs's writeWithEnvelope() for a queue-sourced intent —
 * that resolution + call happens exclusively in executeApprovedWriteIntent()
 * below, gated on the queue record's own state.
 *
 * Concretely, the state machine this module enforces:
 *   1. ApprovalQueue.enqueue() records state 'awaiting_approval' — this
 *      module never calls a governed adapter for a record in that state.
 *   2. A human or policy actor calls ApprovalQueue.approve()/deny() out of
 *      band (CLI, dashboard, MCP resume) — this module does not decide
 *      approval, it only checks the decision already recorded.
 *   3. drainApprovedWriteIntents() scans the queue for state === 'approved'
 *      records, acquires a durable execution lease on each one
 *      (ApprovalQueue.acquireLease, ADR-0089) before resolving the matching
 *      governed adapter (lib/providers/contract/adapters/*\/governed-write.mjs,
 *      built by J3-J5) and calling writeWithEnvelope() exactly once per
 *      record. A record another caller already holds a live lease on is
 *      skipped for this tick, not retried within it — the durable lease,
 *      not an in-memory Set, is what makes two concurrent drain callers (or
 *      a drain racing a manual `construct approvals approve <id>`) safe
 *      against double-execution. The envelope's own idempotency key +
 *      sent-log dedup (lib/writes/sent-log.mjs) remain the independent
 *      second guard against *sequential* re-delivery once a lease
 *      legitimately expires mid-flight (ADR-0089 point 3) — a re-drain of
 *      an already-sent record is a cache hit there, not a second external
 *      write.
 *
 * Per ADR-0096 (superseding ADR-0094), drainApprovedWriteIntents is the
 * adopted production batch drain — a daemon job or scheduled task is
 * authorized to call it directly. Manual single-record approval
 * (lib/cli/approvals.mjs `construct approvals approve <id>`) remains a
 * valid fallback path and does not itself take a lease; the two race safely
 * for the same record because acquireLease is atomic and sent-log
 * idempotency covers the case where CLI approval executes a record before
 * a concurrent drain tick observes the lease.
 *
 * One authority ledger, not several. Every authority decision this chokepoint
 * (or one of its formerly-satellite recorders) makes is appended to
 * lib/writes/authority-ledger.mjs's shared JSONL store: a provider-write
 * intent reaching execution here, an MCP destructive-tool approval-token
 * issuance/consumption (lib/mcp/destructive-approval.mjs), and a role-fence
 * approval notice (lib/hooks/edit-guard.mjs, guard-bash.mjs,
 * lib/embedded-contract/workflow-invoke.mjs — formerly routed through the
 * now-deleted lib/roles/approval-surface.mjs). This module re-exports that
 * ledger's API so any caller that already imports the chokepoint gets it for
 * free; hot-path hooks import lib/writes/authority-ledger.mjs directly to
 * avoid pulling this file's heavier adapter-factory graph into a lazy,
 * per-tool-call import.
 *
 * No dependency on lib/embed/daemon.mjs or lib/embed/capability-jobs.mjs —
 * only the ApprovalQueue class shape is required, so a queue instance handed
 * over by the daemon, a CLI command, or a test drains the same way, without
 * reaching into daemon internals.
 */

import { writeWithEnvelope } from './envelope.mjs';
import { WriteSentLog } from './sent-log.mjs';
import { parseWriteIntentToolName, KNOWN_PROVIDERS } from './write-intent.mjs';
import { resolveWritePolicy } from './write-policy.mjs';
import { DEFAULT_ADAPTER_FACTORIES } from '../providers/contract/adapter-factories.mjs';
import { recordAuthorityEvent, recordApprovalNotice, listAuthorityEvents } from './authority-ledger.mjs';

export { recordAuthorityEvent, recordApprovalNotice, listAuthorityEvents };

export const DEFAULT_MAX_EXECUTION_ATTEMPTS = 5;

/**
 * Execute exactly one approved queue record through the envelope. Throws if
 * the record's state is neither 'approved' nor 'executing' — this is the
 * structural gate: there is no code path in this module that reaches
 * writeWithEnvelope() without first observing a decision already recorded
 * as 'approved' on the queue record itself. 'executing' is admitted too
 * because it is reachable only via ApprovalQueue.acquireLease() called on an
 * 'approved' record (ADR-0089) — the approval decision that gates envelope
 * access already happened before the lease existed, so this does not weaken
 * the guard, it recognizes the lease-held phase of the same decision
 * (drainApprovedWriteIntents below passes the lease-acquired record here).
 *
 * @param {object} record - an ApprovalQueue record (state, toolCall, requestedBy, approvalId)
 * @param {object} [opts]
 * @param {Record<string, () => object>} [opts.adapterFactories] - override adapter resolution (tests)
 * @param {WriteSentLog} [opts.sentLog]
 * @param {string} [opts.rootDir]
 * @returns {Promise<object>} the envelope result ({ status, envelope })
 */
export async function executeApprovedWriteIntent(record, opts = {}) {
  if (!record || (record.state !== 'approved' && record.state !== 'executing')) {
    throw new Error(
      `executeApprovedWriteIntent: refusing to execute record in state "${record?.state ?? 'unknown'}" — only 'approved' records may reach the envelope (or an 'executing' record already holding a lease acquired from one, ADR-0089)`,
    );
  }

  const parsed = parseWriteIntentToolName(record.toolCall?.tool);
  if (!parsed) {
    throw new Error(`executeApprovedWriteIntent: cannot resolve provider from tool name "${record.toolCall?.tool}"`);
  }

  const factories = opts.adapterFactories ?? DEFAULT_ADAPTER_FACTORIES;
  const factory = factories[parsed.providerId];
  if (!factory) {
    throw new Error(`executeApprovedWriteIntent: no governed adapter registered for provider "${parsed.providerId}"`);
  }
  const adapter = factory();

  const sentLog = opts.sentLog ?? new WriteSentLog({ persistPath: WriteSentLog.resolvePersistPath(opts.rootDir ?? process.cwd()) });

  // Every approved write intent this chokepoint executes is logged to the
  // shared authority ledger before the envelope call, so a provider-write
  // approval and an MCP destructive-tool-token approval land in the same
  // durable store regardless of which surface produced the decision.

  recordAuthorityEvent({
    kind: 'provider-write',
    scope: record.toolCall?.tool ?? null,
    decision: 'approved',
    actor: record.requestedBy ?? {},
    reason: record.reason ?? null,
    meta: { approvalId: record.approvalId, surface: record.toolCall?.surface ?? null },
  }, { rootDir: opts.rootDir });

  return writeWithEnvelope({
    provider: adapter,
    config: {},
    payload: { type: parsed.writeKind, ...(record.toolCall?.args ?? {}) },
    dryRun: false,
    sentLog,
    idempotencyKey: record.toolCall?.argsHash,
    requestedBy: record.requestedBy ?? {},
  });
}

/**
 * Drain every 'approved' record in an ApprovalQueue through the envelope,
 * lease-guarded per ADR-0089/ADR-0096. Reclaims any 'executing' record whose
 * lease has already expired (a crashed prior drain attempt, or a crashed CLI
 * approve) back to 'approved' before listing, so a crash mid-execution stays
 * retryable instead of permanently invisible to this scan. For each
 * 'approved' record, acquires a fresh execution lease
 * (ApprovalQueue.acquireLease) before calling executeApprovedWriteIntent();
 * a record whose lease another caller already holds live returns null from
 * acquireLease and is recorded as skipped for this tick, never as an error
 * and never executed twice. On success the lease releases to the durable
 * terminal 'executed' state, so "already drained" is observable on the
 * queue's own persisted state across processes and restarts, not scoped to
 * one call's local memory. On a thrown execution error the lease releases
 * back to 'approved' so a later drain can retry it.
 *
 * Records in any other state ('awaiting_approval', 'denied', 'expired') are
 * left untouched — this is read-only with respect to the queue's approval
 * decision, it only ever appends outcomes for records already decided
 * 'approved' by something outside this module.
 *
 * @param {import('../embed/approval-queue.mjs').ApprovalQueue} approvalQueue
 * @param {object} [opts]
 * @param {Record<string, () => object>} [opts.adapterFactories]
 * @param {WriteSentLog} [opts.sentLog]
 * @param {string} [opts.rootDir]
 * @param {string} [opts.workerId] - lease-holder identity recorded on each acquired lease (default: one per process)
 * @param {number} [opts.leaseSeconds] - lease duration passed to acquireLease (default: ApprovalQueue's own default, 120s)
 * @returns {Promise<Array<{ approvalId: string, result: object|null, error: string|null, skipped?: string }>>}
 */
export async function drainApprovedWriteIntents(approvalQueue, opts = {}) {
  approvalQueue.reclaimExpiredLeases();

  const workerId = opts.workerId ?? `drain-${process.pid}`;
  const leaseOpts = { workerId, ...(opts.leaseSeconds != null ? { leaseSeconds: opts.leaseSeconds } : {}) };
  const outcomes = [];

  const approvedRecords = approvalQueue.list('approved');
  for (const record of approvedRecords) {
    const leased = approvalQueue.acquireLease(record.approvalId, leaseOpts);
    if (!leased) {
      outcomes.push({ approvalId: record.approvalId, result: null, error: null, skipped: 'lease-not-acquired' });
      continue;
    }

    try {
      const result = await executeApprovedWriteIntent(leased, opts);
      approvalQueue.releaseLease(record.approvalId, { workerId, outcome: 'success' });
      outcomes.push({ approvalId: record.approvalId, result, error: null });
    } catch (err) {
      const message = err.message ?? String(err);
      try {
        approvalQueue.releaseLease(record.approvalId, { workerId, outcome: 'failure', reason: message });
      } catch { /* lease already gone (raced reclaim) — nothing left to release */ }
      outcomes.push({ approvalId: record.approvalId, result: null, error: message });
    }
  }

  return outcomes;
}

/**
 * Auto-grant or auto-deny pending write-intent records per `writes.policy`
 * (lib/writes/write-policy.mjs), leaving anything policy-unmapped (mode
 * 'approval', the fail-safe default) for a human. Scoped strictly to
 * governed write intents — a pending record whose tool name does not parse
 * as "<knownProvider>.<writeKind>" is another runtime's proposal and is left
 * untouched, mirroring the same scoping `construct approvals approve`
 * already applies (lib/cli/approvals.mjs).
 *
 * @param {import('../embed/approval-queue.mjs').ApprovalQueue} approvalQueue
 * @param {object} [config] - a loaded construct.config.json
 * @param {object} [opts]
 * @param {object} [opts.decidedBy] - actor identity recorded on the decision
 * @returns {Array<{ approvalId: string, decision: 'approved'|'denied' }>}
 */
export function autoGrantWriteIntents(approvalQueue, config, opts = {}) {
  const decidedBy = opts.decidedBy ?? { serviceId: 'write-policy-auto-grant' };
  const decisions = [];

  for (const record of approvalQueue.getPending()) {
    const parsed = parseWriteIntentToolName(record.toolCall?.tool);
    if (!parsed || !KNOWN_PROVIDERS.includes(parsed.providerId)) continue;

    const mode = resolveWritePolicy(parsed.providerId, parsed.writeKind, config);
    if (mode === 'auto') {
      approvalQueue.approve(record.approvalId, { decidedBy, reason: 'auto-granted per writes.policy' });
      decisions.push({ approvalId: record.approvalId, decision: 'approved' });
    } else if (mode === 'deny') {
      approvalQueue.deny(record.approvalId, { decidedBy, reason: 'auto-denied per writes.policy' });
      decisions.push({ approvalId: record.approvalId, decision: 'denied' });
    }
  }

  return decisions;
}
