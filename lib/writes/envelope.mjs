/**
 * lib/writes/envelope.mjs — the single governed path for external writes.
 *
 * writeWithEnvelope() runs every external write through: idempotency key →
 * sent-log dedup → dry-run render → policy/approval gate → rate-limited retry →
 * sent-log append + audit. Specialists never call provider adapters directly;
 * they recommend a write-intent and the control plane executes it here.
 */

import crypto from 'node:crypto';
import { WriteSentLog } from './sent-log.mjs';
import { ApprovalQueue } from '../embed/approval-queue.mjs';

/**
 * Execute a governed write through the envelope.
 *
 * Flow:
 *   1. Generate idempotency key (if none provided) from provider + writeType + stable payload hash
 *   2. Check sent-log: if same key already succeeded, return cached result
 *   3. Dry-run mode: return rendered payload without executing
 *   4. Policy gate: if broker provided, run policy check
 *      - If approval required, create durable approval record and return awaiting_approval
 *   5. Execute provider.write() with retry
 *   6. Record in sent-log
 *   7. Append audit record
 *   8. Return structured result with linkback
 *
 * @param {object} spec
 * @param {object} spec.provider - Provider instance with write() method
 * @param {object} spec.config - Provider configuration
 * @param {object} spec.payload - Write payload (e.g. { type: 'issue', title, body, ... })
 * @param {string} [spec.idempotencyKey] - Explicit idempotency key (auto-generated if absent)
 * @param {boolean} [spec.dryRun] - If true, return rendered payload without executing
 * @param {object} [spec.broker] - Broker instance for policy gating
 * @param {ApprovalQueue} [spec.approvalQueue] - For durable approval
 * @param {WriteSentLog} [spec.sentLog] - For idempotency tracking
 * @param {object} [spec.requestedBy] - Actor identity { userId, serviceId, role }
 * @param {object} [spec.traceInfo] - { traceId, spanId } for observability
 * @param {number} [spec.maxRetries] - Max retry attempts on rate-limit (default 3)
 * @returns {object} { status: 'sent'|'awaiting_approval'|'denied'|'error'|'cached', envelope: {...} }
 */
export async function writeWithEnvelope(spec) {
  const {
    provider, config, payload,
    idempotencyKey: explicitKey,
    dryRun = false,
    broker, approvalQueue, sentLog,
    requestedBy = {},
    traceInfo = {},
    maxRetries = 3,
  } = spec;

  const payloadStable = JSON.stringify(payload, Object.keys(payload).sort());
  const idempotencyKey = explicitKey || crypto
    .createHash('sha256')
    .update(`${provider.meta?.id || 'unknown'}:${payload.type || 'write'}:${payloadStable}`)
    .digest('hex')
    .slice(0, 24);

  const writeType = payload.type || 'write';
  const providerId = provider.meta?.id || spec.providerId || 'unknown';
  const now = new Date().toISOString();

  if (sentLog) {
    const existing = sentLog.findByIdempotencyKey(idempotencyKey);
    if (existing && existing.status === 'sent') {
      return {
        status: 'cached',
        envelope: {
          idempotencyKey,
          sentAt: existing.sentAt,
          provider: existing.provider || providerId,
          writeType,
          state: 'sent',
          externalUrl: existing.externalUrl,
          externalId: existing.externalId,
          result: existing.result,
        },
      };
    }
  }

  if (sentLog) {
    sentLog.record({ idempotencyKey, writeType, provider: providerId, sentAt: now, status: 'pending' });
  }

  if (dryRun) {
    return {
      status: 'dry-run',
      envelope: {
        idempotencyKey,
        sentAt: now,
        provider: providerId,
        writeType,
        state: 'dry-run',
        payload,
      },
    };
  }

  if (broker) {
    try {
      const policyResult = await broker.invoke({
        role: requestedBy.role || 'member',
        tool: `write:${providerId}:${writeType}`,
        action: 'write',
        toolArgs: payload,
        risk: 'write',
        requestedBy,
        resumeToken: spec.resumeToken,
        execute: async () => ({ ok: true, deferred: true }),
      });

      if (policyResult.status === 'awaiting_approval') {
        if (sentLog) sentLog.record({
          idempotencyKey, writeType, provider: providerId, sentAt: now,
          status: 'awaiting_approval',
          result: { approvalId: policyResult.approvalId },
        });
        return {
          status: 'awaiting_approval',
          envelope: {
            idempotencyKey,
            approvalId: policyResult.approvalId,
            resumeToken: policyResult.resumeToken,
            expiresAt: policyResult.expiresAt,
          },
        };
      }

      if (policyResult.status === 'denied') {
        if (sentLog) sentLog.record({
          idempotencyKey, writeType, provider: providerId, sentAt: now,
          status: 'denied',
          error: policyResult.reason || 'denied by policy',
        });
        return {
          status: 'denied',
          envelope: { idempotencyKey, reason: policyResult.reason },
        };
      }
    } catch (err) {
      // Broker.invoke() throws PolicyDenied/ApprovalRequired/RateLimited (lib/mcp/broker.mjs)
      // and BudgetExceeded (lib/policy/consumption-budget.mjs) instead of returning a status
      // for callers that didn't configure an approvalQueue. Every one of these must block
      // execution the same way the non-throw denied/awaiting_approval paths above do — an
      // unrecognized error name falls through to a re-throw rather than silently letting
      // provider.write() run.

      if (err.name === 'PolicyDenied') {
        return { status: 'denied', envelope: { idempotencyKey, reason: err.message } };
      }
      if (err.name === 'ApprovalRequired') {
        return {
          status: 'awaiting_approval',
          envelope: { idempotencyKey, reason: err.message, correlationId: err.correlationId },
        };
      }
      if (err.name === 'BudgetExceeded' || err.name === 'RateLimited') {
        return { status: 'denied', envelope: { idempotencyKey, reason: err.message } };
      }
      throw err;
    }
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await provider.write(config, payload);
      const externalUrl = result?.url || result?.externalUrl || null;
      const externalId = result?.id || result?.key || result?.externalId || null;

      if (sentLog) {
        sentLog.record({
          idempotencyKey, writeType, provider: providerId, sentAt: now,
          completedAt: new Date().toISOString(),
          status: 'sent',
          externalUrl, externalId, result,
        });
      }

      return {
        status: 'sent',
        envelope: {
          idempotencyKey,
          sentAt: now,
          provider: providerId,
          writeType,
          state: 'sent',
          externalUrl,
          externalId,
          result,
        },
      };
    } catch (err) {
      lastError = err;
      const isRateLimit = err.message?.includes('rate') || err.status === 429;
      if (!isRateLimit || attempt >= maxRetries) break;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
  }

  if (sentLog) {
    sentLog.record({
      idempotencyKey, writeType, provider: providerId, sentAt: now,
      completedAt: new Date().toISOString(),
      status: 'failed',
      error: lastError?.message || String(lastError),
    });
  }

  return {
    status: 'error',
    envelope: {
      idempotencyKey,
      sentAt: now,
      provider: providerId,
      writeType,
      state: 'failed',
      error: lastError?.message || String(lastError),
    },
  };
}