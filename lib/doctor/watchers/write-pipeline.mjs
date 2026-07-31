/**
 * lib/doctor/watchers/write-pipeline.mjs — governed-write pipeline health.
 *
 * Ticks every 5 minutes. Surfaces two honest failure signals from the
 * lib/writes/ pipeline: approval records still `awaiting_approval` past
 * their own expiresAt (nothing has drained or expired them), and sent-log
 * entries that recorded an `error` outcome. Escalates each id once, not
 * once per tick.
 */

import { ApprovalQueue } from '../../embed/approval-queue.mjs';
import { WriteSentLog } from '../../writes/sent-log.mjs';
import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';

export const name = 'write-pipeline';
export const intervalMs = 5 * 60 * 1000;

const escalatedApprovalIds = new Set();
const escalatedSentLogKeys = new Set();

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const notes = [];
  const root = projectRoot();

  const approvalQueue = new ApprovalQueue({ persistPath: ApprovalQueue.resolvePersistPath(root, process.env.CONSTRUCT_DEPLOYMENT_MODE) });
  const now = Date.now();
  const stalePending = approvalQueue
    .getPending()
    .filter((item) => new Date(item.expiresAt).getTime() < now);

  notes.push({ pending: approvalQueue.getPending().length, stalePending: stalePending.length });

  for (const item of stalePending) {
    if (escalatedApprovalIds.has(item.approvalId)) continue;
    const summary = `approval ${item.approvalId} (${item.toolCall?.tool}) has been awaiting_approval past its expiry (${item.expiresAt}) — nothing has drained or expired it`;
    record({
      kind: 'sample',
      watcher: name,
      target: item.approvalId,
      result: 'stale',
      summary,
      context: { tool: item.toolCall?.tool, requestedAt: item.requestedAt, expiresAt: item.expiresAt },
    });
    const result = await escalate({
      watcher: name,
      eventType: 'write.approval_stale',
      summary,
      context: { approvalId: item.approvalId, tool: item.toolCall?.tool },
    });
    escalatedApprovalIds.add(item.approvalId);
    escalations.push({ eventType: 'write.approval_stale', approvalId: item.approvalId, result });
  }

  const sentLog = new WriteSentLog({ persistPath: WriteSentLog.resolvePersistPath(root) });
  const failed = sentLog.list({ status: 'error' });
  notes.push({ sentLogErrors: failed.length });

  for (const entry of failed) {
    const key = entry.idempotencyKey ?? `${entry.provider}:${entry.sentAt}`;
    if (escalatedSentLogKeys.has(key)) continue;
    const summary = `write to ${entry.provider} (${entry.writeType}) failed: ${entry.error ?? 'unknown error'}`;
    record({
      kind: 'sample',
      watcher: name,
      target: key,
      result: 'error',
      summary,
      context: { provider: entry.provider, writeType: entry.writeType, error: entry.error },
    });
    const result = await escalate({
      watcher: name,
      eventType: 'write.send_failed',
      summary,
      context: { idempotencyKey: entry.idempotencyKey, provider: entry.provider },
    });
    escalatedSentLogKeys.add(key);
    escalations.push({ eventType: 'write.send_failed', idempotencyKey: key, result });
  }

  return { actions, escalations, notes };
}

export function __resetWritePipelineWatcherState() {
  escalatedApprovalIds.clear();
  escalatedSentLogKeys.clear();
}
