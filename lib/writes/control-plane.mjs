/**
 * lib/writes/control-plane.mjs — the only entry point that turns a queued
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
 * No dependency on lib/embed/daemon.mjs or lib/embed/capability-jobs.mjs —
 * only the ApprovalQueue class shape is required, so a queue instance handed
 * over by the daemon, a CLI command, or a test drains the same way, without
 * reaching into daemon internals.
 */

import { writeWithEnvelope } from './envelope.mjs';
import { WriteSentLog } from './sent-log.mjs';
import { parseWriteIntentToolName } from './write-intent.mjs';
import { createGovernedJiraProvider } from '../providers/contract/adapters/jira/governed-write.mjs';
import { createJiraTransport } from '../providers/contract/adapters/jira/transport.mjs';
import { createGovernedConfluenceProvider } from '../providers/contract/adapters/confluence/governed-write.mjs';
import { createConfluenceTransport } from '../providers/contract/adapters/confluence/transport.mjs';
import { createGovernedGithubProvider } from '../providers/contract/adapters/github/governed-write.mjs';
import githubAdapter from '../providers/contract/adapters/github/index.mjs';
import { createGovernedSlackProvider } from '../providers/contract/adapters/slack/governed-write.mjs';
import { createSlackTransport } from '../providers/contract/adapters/slack/transport.mjs';

/**
 * Default adapter factories, one per known governed provider. Lazy per-call
 * construction (not module-load-time) keeps a missing-credential error
 * scoped to the one drain call that needed that provider, matching
 * lib/mcp/tools/provider-write.mjs's resolution strategy.
 */
const DEFAULT_ADAPTER_FACTORIES = {
  'atlassian-jira': () => createGovernedJiraProvider({ jiraTransport: createJiraTransport() }),
  'atlassian-confluence': () => createGovernedConfluenceProvider({ confluenceTransport: createConfluenceTransport() }),
  github: () => createGovernedGithubProvider({ ghAdapter: githubAdapter }),
  slack: () => createGovernedSlackProvider({ slackTransport: createSlackTransport() }),
};

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
 * marking each executed record so a subsequent drain does not re-execute it
 * (the envelope's sent-log dedup is a second, independent line of defense,
 * not the only one — this in-memory executed-set makes the "exactly one
 * adapter call" property observable per drain call even before sent-log
 * persistence is consulted).
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
 * @returns {Promise<Array<{ approvalId: string, result: object|null, error: string|null }>>}
 */
export async function drainApprovedWriteIntents(approvalQueue, opts = {}) {
  const executed = opts.executedApprovalIds ?? new Set();
  const outcomes = [];

  const approvedRecords = approvalQueue.list('approved');
  for (const record of approvedRecords) {
    if (executed.has(record.approvalId)) continue;

    try {
      const result = await executeApprovedWriteIntent(record, opts);
      executed.add(record.approvalId);
      outcomes.push({ approvalId: record.approvalId, result, error: null });
    } catch (err) {
      outcomes.push({ approvalId: record.approvalId, result: null, error: err.message ?? String(err) });
    }
  }

  return outcomes;
}
