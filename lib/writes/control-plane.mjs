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
 *      records this module has not yet executed, resolves the matching
 *      governed adapter (lib/providers/contract/adapters/*\/governed-write.mjs,
 *      built by J3-J5), and calls writeWithEnvelope() exactly once per
 *      record — the envelope's own idempotency key + sent-log dedup still
 *      apply on top, so a re-drain of an already-sent record is a cache hit,
 *      not a second external write.
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
 * the record's state is not 'approved' — this is the structural gate: there
 * is no code path in this module that reaches writeWithEnvelope() without
 * first observing state === 'approved' on the queue record itself.
 *
 * @param {object} record - an ApprovalQueue record (state, toolCall, requestedBy, approvalId)
 * @param {object} [opts]
 * @param {Record<string, () => object>} [opts.adapterFactories] - override adapter resolution (tests)
 * @param {WriteSentLog} [opts.sentLog]
 * @param {string} [opts.rootDir]
 * @returns {Promise<object>} the envelope result ({ status, envelope })
 */
export async function executeApprovedWriteIntent(record, opts = {}) {
  if (!record || record.state !== 'approved') {
    throw new Error(
      `executeApprovedWriteIntent: refusing to execute record in state "${record?.state ?? 'unknown'}" — only 'approved' records may reach the envelope`,
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
 * Drain every 'approved' record in an ApprovalQueue through the envelope.
 * Two independent dedup lines guard against a repeat execution:
 *
 *   1. The durable `executedAt`/`executionAttempts` fields on the record
 *      itself (ApprovalQueue.recordExecutionOutcome), which survive a
 *      daemon restart — a record already succeeded is skipped outright, and
 *      one that has failed `maxAttempts` times is left alone rather than
 *      retried forever against a permanently broken target (the doctor
 *      write-pipeline watcher surfaces it from there).
 *   2. The `executedApprovalIds` in-memory set (opt-in, mutated in place),
 *      predating (1), kept for callers/tests that want "don't re-execute
 *      within this same drain call" without touching queue persistence.
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
 * @param {Set<string>} [opts.executedApprovalIds] - approvalIds already drained; mutated in place
 * @param {number} [opts.maxAttempts] - stop retrying a record after this many failed attempts (default 5)
 * @returns {Promise<Array<{ approvalId: string, result: object|null, error: string|null }>>}
 */
export async function drainApprovedWriteIntents(approvalQueue, opts = {}) {
  const executed = opts.executedApprovalIds ?? new Set();
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_EXECUTION_ATTEMPTS;
  const outcomes = [];

  const approvedRecords = approvalQueue.list('approved');
  for (const record of approvedRecords) {
    if (executed.has(record.approvalId)) continue;
    if (record.executedAt) continue;
    if ((record.executionAttempts ?? 0) >= maxAttempts) continue;

    try {
      const result = await executeApprovedWriteIntent(record, opts);
      executed.add(record.approvalId);
      approvalQueue.recordExecutionOutcome(record.approvalId, { ok: true, result });
      outcomes.push({ approvalId: record.approvalId, result, error: null });
    } catch (err) {
      const message = err.message ?? String(err);
      approvalQueue.recordExecutionOutcome(record.approvalId, { ok: false, error: message });
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
