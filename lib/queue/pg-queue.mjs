/**
 * lib/queue/pg-queue.mjs — optional Postgres kind:'queue' provider.
 *
 * Claiming uses a single UPDATE fed by SELECT ... FOR UPDATE SKIP LOCKED so
 * parallel workers contend inside Postgres instead of racing in process memory.
 */

import crypto from 'node:crypto';

import { applyMigrations } from '../db/migrate.mjs';

export const PG_QUEUE_DEFAULT_NAME = 'intake';
export const PG_QUEUE_DEFAULT_LEASE_SECONDS = 120;
export const PG_QUEUE_DEFAULT_MAX_ATTEMPTS = 3;

export function newQueueId(prefix = 'pkt') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEntry(entry, id) {
  return {
    ...entry,
    id,
    status: entry?.status || 'pending',
    createdAt: entry?.createdAt || nowIso(),
  };
}

function rowToEntry(row) {
  return row?.payload || null;
}

function leaseInterval(sql, seconds) {
  return sql`${Number(seconds)} * interval '1 second'`;
}

function backoffInterval(sql, seconds) {
  return sql`${Math.max(0, Number(seconds) || 0)} * interval '1 second'`;
}

export class PostgresIntakeQueue {
  constructor({
    sql,
    project,
    tenantId = 'local',
    queueName = PG_QUEUE_DEFAULT_NAME,
    leaseSeconds = PG_QUEUE_DEFAULT_LEASE_SECONDS,
  } = {}) {
    if (!sql) throw new Error('PostgresIntakeQueue: sql client is required');
    if (!project) throw new Error('PostgresIntakeQueue: project is required');
    this.sql = sql;
    this.project = project;
    this.tenantId = tenantId;
    this.queueName = queueName;
    this.leaseSeconds = Number(leaseSeconds) || PG_QUEUE_DEFAULT_LEASE_SECONDS;
    this._ensured = null;
  }

  async ensureSchema() {
    if (!this._ensured) this._ensured = applyMigrations(this.sql);
    return this._ensured;
  }

  async enqueue(entry) {
    if (!entry?.intake?.sourcePath) throw new Error('enqueue: entry.intake.sourcePath is required');
    await this.ensureSchema();
    const id = entry.id || newQueueId();
    const payload = normalizeEntry(entry, id);
    await this.sql`
      INSERT INTO construct_queue_items (
        project, tenant_id, queue_name, item_id, status, payload, created_at, updated_at, max_attempts
      ) VALUES (
        ${this.project}, ${this.tenantId}, ${this.queueName}, ${id}, 'pending',
        ${this.sql.json(payload)}, ${payload.createdAt}, now(),
        ${Number(entry.maxAttempts) > 0 ? Math.floor(Number(entry.maxAttempts)) : PG_QUEUE_DEFAULT_MAX_ATTEMPTS}
      )
      ON CONFLICT (project, tenant_id, queue_name, item_id) DO UPDATE SET
        payload = EXCLUDED.payload,
        status = EXCLUDED.status,
        max_attempts = EXCLUDED.max_attempts,
        updated_at = now()
    `;
    return { id };
  }

  async listPending() {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload FROM construct_queue_items
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
        AND status = 'pending'
      ORDER BY created_at ASC, item_id ASC
    `;
    return rows.map(rowToEntry);
  }

  async count() {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT COUNT(*)::int AS count FROM construct_queue_items
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
        AND status = 'pending'
    `;
    return Number(rows[0]?.count || 0);
  }

  async read(id) {
    if (!id) return null;
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT payload FROM construct_queue_items
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
        AND item_id = ${id}
      LIMIT 1
    `;
    return rowToEntry(rows[0]);
  }

  async claim({ claimedBy, leaseSeconds = this.leaseSeconds } = {}) {
    if (!claimedBy) throw new Error('claim: claimedBy is required');
    await this.ensureSchema();
    const claimId = newQueueId('claim');
    const rows = await this.sql`
      WITH candidate AS (
        SELECT item_id
        FROM construct_queue_items
        WHERE project = ${this.project}
          AND tenant_id = ${this.tenantId}
          AND queue_name = ${this.queueName}
          AND available_at <= now()
          AND (
            status = 'pending'
            OR (status = 'claimed' AND lease_expires_at <= now() AND attempt < max_attempts)
          )
        ORDER BY created_at ASC, item_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ),
      updated AS (
        UPDATE construct_queue_items q
        SET status = 'claimed',
            attempt = q.attempt + 1,
            claimed_by = ${claimedBy},
            lease_expires_at = now() + ${leaseInterval(this.sql, leaseSeconds)},
            updated_at = now(),
            payload = jsonb_set(
              jsonb_set(
                jsonb_set(q.payload, '{status}', to_jsonb('claimed'::text), true),
                '{claimedBy}', to_jsonb(${claimedBy}::text), true
              ),
              '{claimedAt}', to_jsonb(now()::text), true
            )
        FROM candidate
        WHERE q.project = ${this.project}
          AND q.tenant_id = ${this.tenantId}
          AND q.queue_name = ${this.queueName}
          AND q.item_id = candidate.item_id
        RETURNING q.item_id, q.attempt, q.lease_expires_at, q.payload
      )
      INSERT INTO construct_queue_claims (
        claim_id, project, tenant_id, queue_name, item_id, worker_id, attempt, lease_expires_at
      )
      SELECT ${claimId}, ${this.project}, ${this.tenantId}, ${this.queueName},
             item_id, ${claimedBy}, attempt, lease_expires_at
      FROM updated
      RETURNING item_id, attempt, lease_expires_at,
        (SELECT payload FROM updated WHERE updated.item_id = construct_queue_claims.item_id) AS payload
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      ...row.payload,
      id: row.payload?.id || row.item_id,
      status: 'claimed',
      claimedBy,
      attempt: row.attempt,
      leaseExpiresAt: row.lease_expires_at,
      claimId,
    };
  }

  async heartbeat(id, { workerId, leaseSeconds = this.leaseSeconds } = {}) {
    if (!id) throw new Error('heartbeat: id is required');
    if (!workerId) throw new Error('heartbeat: workerId is required');
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE construct_queue_items
      SET lease_expires_at = now() + ${leaseInterval(this.sql, leaseSeconds)},
          updated_at = now()
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
        AND item_id = ${id}
        AND status = 'claimed'
        AND claimed_by = ${workerId}
        AND lease_expires_at > now()
        AND COALESCE((payload->>'cancelRequested')::boolean, false) = false
      RETURNING item_id, lease_expires_at
    `;
    if (!rows[0]) {
      const current = await this.read(id);
      if (current?.cancelRequested) return { id, renewed: false, cancelled: true, reason: current.cancellationReason || null };
      return { id, renewed: false };
    }
    return { id, renewed: true, leaseExpiresAt: rows[0].lease_expires_at };
  }

  async fail(id, { workerId, reason, backoffSeconds = 0 } = {}) {
    if (!id) throw new Error('fail: id is required');
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE construct_queue_items
      SET status = CASE WHEN attempt >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
          available_at = CASE WHEN attempt >= max_attempts THEN available_at ELSE now() + ${backoffInterval(this.sql, backoffSeconds)} END,
          terminal_reason = ${reason || null},
          claimed_by = NULL,
          lease_expires_at = NULL,
          updated_at = now(),
          payload = jsonb_set(
            jsonb_set(
              jsonb_set(payload, '{status}', to_jsonb(CASE WHEN attempt >= max_attempts THEN 'dead_letter'::text ELSE 'pending'::text END), true),
              '{lastFailureReason}', to_jsonb(${reason || ''}::text), true
            ),
            '{failedBy}', to_jsonb(${workerId || ''}::text), true
          )
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
        AND item_id = ${id}
        AND status = 'claimed'
        AND (${workerId || null} IS NULL OR claimed_by = ${workerId || null})
      RETURNING item_id, status, attempt, max_attempts, available_at
    `;
    if (!rows[0]) return null;
    return {
      id,
      status: rows[0].status,
      attempt: rows[0].attempt,
      maxAttempts: rows[0].max_attempts,
      deadLettered: rows[0].status === 'dead_letter',
      availableAt: rows[0].available_at,
    };
  }

  async requestCancellation(id, { requestedBy, reason } = {}) {
    if (!id) throw new Error('requestCancellation: id is required');
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE construct_queue_items
      SET terminal_reason = ${reason || null},
          updated_at = now(),
          payload = jsonb_set(
            jsonb_set(
              jsonb_set(payload, '{cancelRequested}', 'true'::jsonb, true),
              '{cancellationReason}', to_jsonb(${reason || ''}::text), true
            ),
            '{cancelRequestedBy}', to_jsonb(${requestedBy || ''}::text), true
          )
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
        AND item_id = ${id}
        AND status IN ('pending', 'claimed', 'awaiting_approval')
      RETURNING item_id
    `;
    return rows[0] ? { id, cancellationRequested: true } : null;
  }

  async markProcessed(id, { processedBy, notes, executionKey } = {}) {
    if (!id) throw new Error('markProcessed: id is required');
    await this.ensureSchema();
    if (executionKey) {
      const current = await this.read(id);
      if (current?.status === 'processed' && current.executionKey === executionKey) {
        return { id, idempotent: true };
      }
    }
    const rows = await this.sql`
      UPDATE construct_queue_items
      SET status = 'processed',
          processed_at = now(),
          processed_by = ${processedBy || null},
          terminal_reason = ${notes || null},
          claimed_by = NULL,
          lease_expires_at = NULL,
          updated_at = now(),
          payload = jsonb_set(
            jsonb_set(
              jsonb_set(payload, '{status}', to_jsonb('processed'::text), true),
              '{processedAt}', to_jsonb(now()::text), true
            ),
            '{executionKey}', to_jsonb(${executionKey || ''}::text), true
          )
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
        AND item_id = ${id}
        AND status <> 'processed'
      RETURNING item_id
    `;
    return rows[0] ? { id } : null;
  }

  async markSkipped(id, { skippedBy, reason } = {}) {
    if (!id) throw new Error('markSkipped: id is required');
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE construct_queue_items
      SET status = 'skipped',
          skipped_at = now(),
          skipped_by = ${skippedBy || null},
          terminal_reason = ${reason || null},
          claimed_by = NULL,
          lease_expires_at = NULL,
          updated_at = now(),
          payload = jsonb_set(
            jsonb_set(payload, '{status}', to_jsonb('skipped'::text), true),
            '{skippedAt}', to_jsonb(now()::text), true
          )
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
        AND item_id = ${id}
      RETURNING item_id
    `;
    return rows[0] ? { id } : null;
  }

  async reopen(id) {
    if (!id) throw new Error('reopen: id is required');
    await this.ensureSchema();
    const rows = await this.sql`
      UPDATE construct_queue_items
      SET status = 'pending',
          claimed_by = NULL,
          lease_expires_at = NULL,
          processed_at = NULL,
          processed_by = NULL,
          skipped_at = NULL,
          skipped_by = NULL,
          terminal_reason = NULL,
          updated_at = now(),
          payload = jsonb_set(payload, '{status}', to_jsonb('pending'::text), true)
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
        AND item_id = ${id}
      RETURNING item_id
    `;
    return rows[0] ? { id, from: 'postgres' } : null;
  }

  async queueStats() {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT status, COUNT(*)::int AS count
      FROM construct_queue_items
      WHERE project = ${this.project}
        AND tenant_id = ${this.tenantId}
        AND queue_name = ${this.queueName}
      GROUP BY status
    `;
    const byStatus = {
      pending: 0,
      claimed: 0,
      processed: 0,
      skipped: 0,
      awaiting_approval: 0,
      dead_letter: 0,
    };
    for (const row of rows) {
      if (Object.hasOwn(byStatus, row.status)) byStatus[row.status] = Number(row.count || 0);
    }
    return {
      project: this.project,
      tenantId: this.tenantId,
      queueName: this.queueName,
      byStatus,
      pending: byStatus.pending,
      claimed: byStatus.claimed,
      deadLetter: byStatus.dead_letter,
      total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
    };
  }
}
