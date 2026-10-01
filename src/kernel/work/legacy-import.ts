/**
 * kernel/work/legacy-import.ts — one-way import of a frozen tracker JSONL
 * snapshot into the native work ledger.
 *
 * The snapshot is recovery input, never a live writer. Historical closure
 * means the source recorded closure; it is not present verification.
 * Live leases, grants, and credentials are never reactivated.
 */

import type { StateStore } from '../state/open.ts';
import {
  addWorkDependency,
  bindLegacyId,
  createWork,
  getWork,
  getWorkByLegacyId,
  listWorkDependencies,
  supersedeWork,
  type WorkKind,
  type WorkStatus,
} from './service.ts';

export interface LegacyImportReport {
  readonly imported: number;
  readonly skipped: number;
  readonly malformed: readonly string[];
  readonly duplicates: readonly string[];
  readonly orphans: readonly string[];
  readonly byStatus: Readonly<Record<string, number>>;
  readonly dryRun: boolean;
}

interface LegacyIssue {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly notes?: unknown;
  readonly status?: unknown;
  readonly issue_type?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly closed_at?: unknown;
  readonly close_reason?: unknown;
  readonly dependencies?: unknown;
}

function kindOf(issueType: unknown): WorkKind {
  const t = typeof issueType === 'string' ? issueType.toLowerCase() : '';
  if (t === 'epic' || t === 'outcome') return 'outcome';
  if (t === 'bug' || t === 'defect') return 'defect';
  if (t === 'plan') return 'plan';
  return 'task';
}

function statusOf(raw: unknown): WorkStatus {
  const s = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (s === 'closed' || s === 'done') return 'historical';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'blocked') return 'blocked';
  if (s === 'in_progress' || s === 'claimed') return 'open';
  if (s === 'open' || s === 'todo') return 'open';
  return 'historical';
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/**
 * Import a JSONL snapshot. Idempotent: a second run with the same ids skips.
 * `dryRun` reports mapping without writing.
 */
export function importLegacySnapshot(
  store: StateStore,
  input: {
    readonly jsonl: string;
    readonly at: string;
    readonly dryRun: boolean;
    readonly nextId: (prefix: string) => string;
    readonly source?: string;
  },
): LegacyImportReport {
  const malformed: string[] = [];
  const duplicates: string[] = [];
  const orphans: string[] = [];
  const byStatus: Record<string, number> = {};
  const parsed: Array<{ issue: LegacyIssue; line: number }> = [];
  const lines = input.jsonl.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    try {
      const obj = JSON.parse(line) as LegacyIssue & { _type?: string };
      if (obj._type && obj._type !== 'issue') continue;
      parsed.push({ issue: obj, line: i + 1 });
    } catch {
      malformed.push(`line ${String(i + 1)}: not JSON`);
    }
  }

  const seen = new Set<string>();
  const wanted = parsed.filter(({ issue, line }) => {
    const id = asText(issue.id).trim();
    if (!id) {
      malformed.push(`line ${String(line)}: missing id`);
      return false;
    }
    if (seen.has(id)) {
      duplicates.push(id);
      return false;
    }
    seen.add(id);
    return true;
  });

  let imported = 0;
  let skipped = 0;

  const write = (): void => {
    for (const { issue } of wanted) {
      const id = asText(issue.id);
      const existing = getWork(store, id) ?? getWorkByLegacyId(store, id);
      const status = statusOf(issue.status);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (existing) {
        skipped += 1;
        continue;
      }
      if (input.dryRun) {
        imported += 1;
        continue;
      }
      const initialStatus = status === 'blocked' ? 'blocked' : 'open';
      const title = asText(issue.title).trim() || id;
      const extra = [
        asText(issue.description),
        asText(issue.notes),
        asText((issue as { acceptance_criteria?: unknown }).acceptance_criteria),
      ].filter((s) => s.trim() !== '');
      createWork(store, {
        id,
        kind: kindOf(issue.issue_type),
        title,
        description: extra.join('\n\n') || title,
        status: initialStatus,
        at: asText(issue.created_at) || input.at,
        actor: 'legacy-import',
      });
      if (status === 'historical' || status === 'cancelled') {
        store.db
          .prepare(
            `UPDATE work_items SET status = ?, completed_at = ?, reason = ?, claim_owner = NULL, claim_token = NULL, claim_until = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(status, asText(issue.closed_at) || input.at, asText(issue.close_reason) || 'imported as recorded by the source', input.at, id);
      }
      bindLegacyId(store, { legacyId: id, workId: id, source: input.source ?? 'legacy-jsonl', at: input.at });
      imported += 1;
    }
    if (input.dryRun) return;
    for (const { issue } of wanted) {
      const fromId = asText(issue.id);
      if (!Array.isArray(issue.dependencies)) continue;
      for (const dep of issue.dependencies) {
        if (dep === null || typeof dep !== 'object') continue;
        const rec = dep as { depends_on_id?: unknown; issue_id?: unknown; type?: unknown };
        const toId = asText(rec.depends_on_id);
        if (!toId) continue;
        if (!getWork(store, toId)) {
          orphans.push(`${fromId} → ${toId}`);
          continue;
        }
        const kind = rec.type === 'blocks' ? 'blocks' : 'informs';
        const already = listWorkDependencies(store, fromId).some((d) => d.toId === toId && d.kind === kind);
        if (already) continue;
        try {
          addWorkDependency(store, { id: input.nextId('dep'), fromId, toId, kind, at: input.at });
        } catch (error) {
          const message = (error as Error).message;
          if (/UNIQUE|would cycle/.test(message)) continue;
          malformed.push(`${fromId} dependency ${toId}: ${message}`);
        }
        if (rec.type === 'parent-child') {
          store.db.prepare('UPDATE work_items SET parent_id = ? WHERE id = ? AND parent_id IS NULL').run(toId, fromId);
        }
      }
    }
  };

  if (input.dryRun) {
    for (const { issue } of wanted) {
      const status = statusOf(issue.status);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      imported += 1;
    }
    return { imported, skipped, malformed, duplicates, orphans, byStatus, dryRun: true };
  }
  store.transaction(write);
  void supersedeWork;
  return { imported, skipped, malformed, duplicates, orphans, byStatus, dryRun: false };
}
