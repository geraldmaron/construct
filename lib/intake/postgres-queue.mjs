/**
 * lib/intake/postgres-queue.mjs — Postgres adapter for the IntakeQueue interface.
 *
 * Backs team and enterprise deployment modes. Implements the same six-method
 * contract as FilesystemIntakeQueue (enqueue, listPending, count, read,
 * markProcessed, markSkipped, reopen) plus a claim() method that uses
 * SELECT ... FOR UPDATE SKIP LOCKED so concurrent workers cannot grab the
 * same pending item.
 *
 * Triage fields (intake_type, rd_stage, primary_owner, recommended_action,
 * risk, requires_approval, confidence) are flattened into typed columns for
 * efficient filtering; the full packet — including suggestion / related /
 * excerpt / query — lives in payload jsonb so the on-disk and in-table
 * shapes round-trip without loss.
 */

import path from 'node:path';
import { shouldQuarantine } from './quarantine.mjs';

function slugify(value) {
  return String(value || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

let counter = 0;
function timestamp() {
  // Milliseconds + a per-process counter to guarantee uniqueness even when
  // two enqueues fire in the same millisecond (test loops, batched ingests).
  counter = (counter + 1) % 1000;
  const c = String(counter).padStart(3, '0');
  return `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)}-${c}`;
}

function rowToEntry(row) {
  if (!row) return null;
  const payload = row.payload || {};
  return {
    id: row.id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    status: row.status,
    ...payload,
    processedAt: row.processed_at instanceof Date ? row.processed_at.toISOString() : row.processed_at || undefined,
    processedBy: row.processed_by || undefined,
    notes: row.notes || undefined,
    skippedAt: row.skipped_at instanceof Date ? row.skipped_at.toISOString() : row.skipped_at || undefined,
    skippedBy: row.skipped_by || undefined,
    reason: row.skip_reason || undefined,
    claimedAt: row.claimed_at instanceof Date ? row.claimed_at.toISOString() : row.claimed_at || undefined,
    claimedBy: row.claimed_by || undefined,
  };
}

export class PostgresIntakeQueue {
  constructor({ sql, project, tenantId = null } = {}) {
    if (!sql) throw new Error('PostgresIntakeQueue: sql client is required');
    if (!project) throw new Error('PostgresIntakeQueue: project is required');
    this.sql = sql;
    this.project = project;
    this.tenantId = tenantId;
  }

  async enqueue(entry) {
    if (!entry?.intake?.sourcePath) throw new Error('enqueue: entry.intake.sourcePath is required');

    const ts = timestamp();
    const slug = slugify(path.basename(entry.intake.sourcePath, path.extname(entry.intake.sourcePath)));
    const id = `${ts}-${slug}`;
    const triage = entry.triage || {};

    // Quarantine routing: low-confidence packets land in status='quarantined'
    // instead of 'pending' so worker claim() never picks them up. Human
    // reroute via rerouteQuarantined() promotes to 'pending'.
    const quarantineDecision = shouldQuarantine(triage);
    const status = quarantineDecision.quarantine ? 'quarantined' : 'pending';
    const augmentedEntry = quarantineDecision.quarantine
      ? { ...entry, quarantineReason: quarantineDecision.reason }
      : entry;

    await this.sql`
      INSERT INTO construct_intake_items (
        id, project, tenant_id, status,
        intake_type, rd_stage, primary_owner, recommended_action,
        risk, requires_approval, confidence, payload
      ) VALUES (
        ${id}, ${this.project}, ${this.tenantId}, ${status},
        ${triage.intakeType || null}, ${triage.rdStage || null},
        ${triage.primaryOwner || null}, ${triage.recommendedAction || null},
        ${triage.risk || null}, ${triage.requiresApproval || false},
        ${typeof triage.confidence === 'number' ? triage.confidence : null},
        ${this.sql.json(augmentedEntry)}
      )
    `;
    return { id, route: quarantineDecision.quarantine ? 'quarantine' : 'pending', reason: quarantineDecision.reason };
  }

  async listQuarantine({ limit = 100 } = {}) {
    const rows = await this.sql`
      SELECT * FROM construct_intake_items
      WHERE project = ${this.project}
        AND (${this.tenantId}::text IS NULL OR tenant_id IS NOT DISTINCT FROM ${this.tenantId})
        AND status = 'quarantined'
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToEntry);
  }

  async rerouteQuarantined(id, newType, { reroutedBy = 'unknown', reason = '' } = {}) {
    const result = await this.sql`
      UPDATE construct_intake_items
      SET status = 'pending',
          intake_type = ${newType},
          payload = jsonb_set(
            jsonb_set(payload, '{triage,originalIntakeType}', to_jsonb(intake_type::text)),
            '{triage,intakeType}', to_jsonb(${newType}::text)
          ),
          updated_at = now(),
          notes = ${`rerouted by ${reroutedBy}${reason ? `: ${reason}` : ''}`}
      WHERE id = ${id}
        AND project = ${this.project}
        AND status = 'quarantined'
      RETURNING id
    `;
    if (result.count === 0) throw new Error(`rerouteQuarantined: no quarantined entry ${id}`);
    return { id, route: 'pending' };
  }

  async listPending({ limit = 100 } = {}) {
    const rows = await this.sql`
      SELECT * FROM construct_intake_items
      WHERE project = ${this.project}
        AND (${this.tenantId}::text IS NULL OR tenant_id IS NOT DISTINCT FROM ${this.tenantId})
        AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToEntry);
  }

  async count() {
    const rows = await this.sql`
      SELECT COUNT(*)::int AS n FROM construct_intake_items
      WHERE project = ${this.project}
        AND (${this.tenantId}::text IS NULL OR tenant_id IS NOT DISTINCT FROM ${this.tenantId})
        AND status = 'pending'
    `;
    return rows[0]?.n ?? 0;
  }

  async read(id) {
    const rows = await this.sql`
      SELECT * FROM construct_intake_items
      WHERE id = ${id}
        AND project = ${this.project}
        AND (${this.tenantId}::text IS NULL OR tenant_id IS NOT DISTINCT FROM ${this.tenantId})
      LIMIT 1
    `;
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async markProcessed(id, { processedBy = 'unknown', notes = '' } = {}) {
    const result = await this.sql`
      UPDATE construct_intake_items
      SET status = 'processed', processed_at = now(), processed_by = ${processedBy},
          notes = ${notes || null}, updated_at = now()
      WHERE id = ${id}
        AND project = ${this.project}
        AND status IN ('pending', 'claimed')
      RETURNING id
    `;
    if (result.count === 0) throw new Error(`markProcessed: no pending entry ${id}`);
    return { id };
  }

  async markSkipped(id, { skippedBy = 'unknown', reason = '' } = {}) {
    const result = await this.sql`
      UPDATE construct_intake_items
      SET status = 'skipped', skipped_at = now(), skipped_by = ${skippedBy},
          skip_reason = ${reason || null}, updated_at = now()
      WHERE id = ${id}
        AND project = ${this.project}
        AND status IN ('pending', 'claimed')
      RETURNING id
    `;
    if (result.count === 0) throw new Error(`markSkipped: no pending entry ${id}`);
    return { id };
  }

  async reopen(id) {
    const result = await this.sql`
      UPDATE construct_intake_items
      SET status = 'pending',
          processed_at = NULL, processed_by = NULL, notes = NULL,
          skipped_at = NULL, skipped_by = NULL, skip_reason = NULL,
          claimed_at = NULL, claimed_by = NULL,
          updated_at = now()
      WHERE id = ${id}
        AND project = ${this.project}
        AND status IN ('processed', 'skipped')
      RETURNING id, (CASE WHEN processed_at IS NOT NULL THEN 'processed' ELSE 'skipped' END) AS from_status
    `;
    if (result.count === 0) throw new Error(`reopen: no processed or skipped entry ${id}`);
    return { id, from: result[0]?.from_status || 'unknown' };
  }

  /**
   * Atomically claim the next pending intake item for a worker.
   * Uses SELECT ... FOR UPDATE SKIP LOCKED so concurrent workers across
   * processes / containers cannot grab the same item. Returns the claimed
   * entry (with status='claimed'), or null when the queue is empty.
   */
  async claim({ claimedBy }) {
    if (!claimedBy) throw new Error('claim: claimedBy is required');
    return await this.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT * FROM construct_intake_items
        WHERE project = ${this.project}
          AND (${this.tenantId}::text IS NULL OR tenant_id IS NOT DISTINCT FROM ${this.tenantId})
          AND status = 'pending'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      await tx`
        UPDATE construct_intake_items
        SET status = 'claimed', claimed_at = now(), claimed_by = ${claimedBy}, updated_at = now()
        WHERE id = ${row.id}
      `;
      row.status = 'claimed';
      row.claimed_by = claimedBy;
      row.claimed_at = new Date();
      return rowToEntry(row);
    });
  }
}
