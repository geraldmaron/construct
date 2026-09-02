/**
 * kernel/state/drift.ts — observations, drift findings, and proposed lessons.
 *
 * A finding carries its evidence, what it affects, how sure it is, and how to
 * repair it. A lesson walks proposed → checked → approved → admitted and can
 * later be superseded or invalidated; a run never admits one on its own.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './activity.ts';
import {
  assertTransition,
  parseJson,
  requireInstant,
  requireNonEmpty,
  requireOneOf,
  requireUnitInterval,
  toJson,
} from './rows.ts';

export interface Observation {
  readonly id: string;
  readonly runId: string | null;
  readonly sourceId: string | null;
  readonly kind: string;
  readonly summary: string;
  readonly evidence: unknown;
  readonly observedAt: string;
}

export function recordObservation(
  store: StateStore,
  input: {
    readonly id: string;
    readonly runId?: string;
    readonly sourceId?: string;
    readonly kind: string;
    readonly summary: string;
    readonly evidence?: unknown;
    readonly at: string;
  },
): Observation {
  requireNonEmpty(input.id, 'observation.id');
  requireNonEmpty(input.kind, 'observation.kind');
  requireNonEmpty(input.summary, 'observation.summary');
  requireInstant(input.at, 'observation.at');
  store.db
    .prepare(
      `INSERT INTO observations (id, run_id, source_id, kind, summary, evidence_json, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.runId ?? null,
      input.sourceId ?? null,
      input.kind,
      input.summary,
      input.evidence === undefined ? null : toJson(input.evidence),
      input.at,
    );
  return {
    id: input.id,
    runId: input.runId ?? null,
    sourceId: input.sourceId ?? null,
    kind: input.kind,
    summary: input.summary,
    evidence: input.evidence ?? null,
    observedAt: input.at,
  };
}

export function listObservations(
  store: StateStore,
  filter: { readonly runId?: string; readonly sourceId?: string; readonly limit?: number } = {},
): Observation[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 200, 2000));
  const rows = store.db
    .prepare(
      `SELECT * FROM observations
        WHERE (? IS NULL OR run_id = ?) AND (? IS NULL OR source_id = ?)
        ORDER BY observed_at, id LIMIT ?`,
    )
    .all(filter.runId ?? null, filter.runId ?? null, filter.sourceId ?? null, filter.sourceId ?? null, limit) as unknown as Array<{
    id: string;
    run_id: string | null;
    source_id: string | null;
    kind: string;
    summary: string;
    evidence_json: string | null;
    observed_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    sourceId: r.source_id,
    kind: r.kind,
    summary: r.summary,
    evidence: parseJson(r.evidence_json),
    observedAt: r.observed_at,
  }));
}

export const DRIFT_KINDS = [
  'stale_dependent_claims',
  'unverified_obligation',
  'change_without_decision',
  'unlinked_requirement',
  'contradicts_obligation',
  'duplicate_active_document',
  'initiative_incomplete',
  'work_without_goal',
  'capacity_conflict',
  'insufficient_authority',
] as const;
export type DriftKind = (typeof DRIFT_KINDS)[number];

export const DRIFT_STATUSES = ['open', 'acknowledged', 'repaired', 'dismissed'] as const;
export type DriftStatus = (typeof DRIFT_STATUSES)[number];

const DRIFT_TRANSITIONS: Readonly<Record<DriftStatus, readonly DriftStatus[]>> = {
  open: ['acknowledged', 'repaired', 'dismissed'],
  acknowledged: ['repaired', 'dismissed'],
  repaired: [],
  dismissed: [],
};

export interface DriftFinding {
  readonly id: string;
  readonly runId: string;
  readonly kind: DriftKind;
  readonly summary: string;
  readonly evidence: readonly unknown[];
  readonly affected: readonly string[];
  readonly confidence: number;
  readonly repairPath: string;
  readonly status: DriftStatus;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

interface DriftRow {
  readonly id: string;
  readonly run_id: string;
  readonly kind: DriftKind;
  readonly summary: string;
  readonly evidence_json: string;
  readonly affected_json: string;
  readonly confidence: number;
  readonly repair_path: string;
  readonly status: DriftStatus;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

function toFinding(row: DriftRow): DriftFinding {
  const evidence = parseJson(row.evidence_json);
  const affected = parseJson(row.affected_json);
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    summary: row.summary,
    evidence: Array.isArray(evidence) ? evidence : [],
    affected: Array.isArray(affected) ? (affected as string[]) : [],
    confidence: row.confidence,
    repairPath: row.repair_path,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/** A finding without evidence or an affected obligation is not a finding. */
export function addDriftFinding(
  store: StateStore,
  input: {
    readonly id: string;
    readonly runId: string;
    readonly kind: DriftKind;
    readonly summary: string;
    readonly evidence: readonly unknown[];
    readonly affected: readonly string[];
    readonly confidence: number;
    readonly repairPath: string;
    readonly at: string;
  },
): DriftFinding {
  requireNonEmpty(input.id, 'drift.id');
  requireOneOf(input.kind, DRIFT_KINDS, 'drift.kind');
  requireNonEmpty(input.summary, 'drift.summary');
  requireUnitInterval(input.confidence, 'drift.confidence');
  requireNonEmpty(input.repairPath, 'drift.repairPath');
  requireInstant(input.at, 'drift.at');
  if (input.evidence.length === 0) throw new Error('a drift finding cites at least one piece of evidence');
  if (input.affected.length === 0) throw new Error('a drift finding names at least one affected obligation');
  return store.transaction(() => {
    const row = store.db
      .prepare(
        `INSERT INTO drift_findings
           (id, run_id, kind, summary, evidence_json, affected_json, confidence, repair_path, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?) RETURNING *`,
      )
      .get(
        input.id,
        input.runId,
        input.kind,
        input.summary,
        toJson(input.evidence),
        toJson(input.affected),
        input.confidence,
        input.repairPath,
        input.at,
      ) as unknown as DriftRow;
    appendActivity(store, {
      at: input.at,
      kind: 'drift.found',
      runId: input.runId,
      payload: { findingId: input.id, kind: input.kind, confidence: input.confidence },
    });
    return toFinding(row);
  });
}

export function getDriftFinding(store: StateStore, id: string): DriftFinding | null {
  const row = store.db.prepare('SELECT * FROM drift_findings WHERE id = ?').get(id) as DriftRow | undefined;
  return row ? toFinding(row) : null;
}

export function listDriftFindings(
  store: StateStore,
  filter: { readonly status?: DriftStatus; readonly runId?: string } = {},
): DriftFinding[] {
  const rows = store.db
    .prepare(
      `SELECT * FROM drift_findings
        WHERE (? IS NULL OR status = ?) AND (? IS NULL OR run_id = ?)
        ORDER BY created_at, id`,
    )
    .all(filter.status ?? null, filter.status ?? null, filter.runId ?? null, filter.runId ?? null) as unknown as DriftRow[];
  return rows.map(toFinding);
}

export function setDriftStatus(
  store: StateStore,
  input: { readonly id: string; readonly status: DriftStatus; readonly by: string; readonly at: string },
): DriftFinding {
  requireOneOf(input.status, DRIFT_STATUSES, 'drift.status');
  requireInstant(input.at, 'drift.at');
  return store.transaction(() => {
    const current = getDriftFinding(store, input.id);
    if (!current) throw new Error(`no drift finding ${input.id}`);
    assertTransition(DRIFT_TRANSITIONS, `drift finding ${input.id}`, current.status, input.status);
    const resolved = input.status === 'repaired' || input.status === 'dismissed' ? input.at : null;
    store.db
      .prepare('UPDATE drift_findings SET status = ?, resolved_at = ? WHERE id = ?')
      .run(input.status, resolved, input.id);
    appendActivity(store, {
      at: input.at,
      kind: 'drift.status',
      runId: current.runId,
      actor: input.by,
      payload: { findingId: input.id, from: current.status, to: input.status },
    });
    return getDriftFinding(store, input.id)!;
  });
}

export const LESSON_STATUSES = ['proposed', 'checked', 'approved', 'admitted', 'superseded', 'invalidated'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const LESSON_TRANSITIONS: Readonly<Record<LessonStatus, readonly LessonStatus[]>> = {
  proposed: ['checked', 'invalidated'],
  checked: ['approved', 'invalidated'],
  approved: ['admitted', 'invalidated'],
  admitted: ['superseded', 'invalidated'],
  superseded: [],
  invalidated: [],
};

export interface Lesson {
  readonly id: string;
  readonly statement: string;
  readonly version: number;
  readonly status: LessonStatus;
  readonly evidence: readonly unknown[];
  readonly scope: readonly string[];
  readonly runId: string | null;
  readonly supersededBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface LessonRow {
  readonly id: string;
  readonly statement: string;
  readonly version: number;
  readonly status: LessonStatus;
  readonly evidence_json: string;
  readonly scope_json: string;
  readonly run_id: string | null;
  readonly superseded_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function toLesson(row: LessonRow): Lesson {
  const evidence = parseJson(row.evidence_json);
  const scope = parseJson(row.scope_json);
  return {
    id: row.id,
    statement: row.statement,
    version: row.version,
    status: row.status,
    evidence: Array.isArray(evidence) ? evidence : [],
    scope: Array.isArray(scope) ? (scope as string[]) : [],
    runId: row.run_id,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function proposeLesson(
  store: StateStore,
  input: {
    readonly id: string;
    readonly statement: string;
    readonly evidence: readonly unknown[];
    readonly scope: readonly string[];
    readonly runId?: string;
    readonly version?: number;
    readonly at: string;
  },
): Lesson {
  requireNonEmpty(input.id, 'lesson.id');
  requireNonEmpty(input.statement, 'lesson.statement');
  requireInstant(input.at, 'lesson.at');
  if (input.evidence.length === 0) throw new Error('a lesson is proposed with evidence');
  if (input.scope.length === 0) throw new Error('a lesson names the scope it affects');
  const version = input.version ?? 1;
  if (!Number.isInteger(version) || version < 1) throw new Error('lesson.version must be a positive integer');
  const row = store.db
    .prepare(
      `INSERT INTO lessons (id, statement, version, status, evidence_json, scope_json, run_id, created_at, updated_at)
       VALUES (?, ?, ?, 'proposed', ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(input.id, input.statement, version, toJson(input.evidence), toJson(input.scope), input.runId ?? null, input.at, input.at) as unknown as LessonRow;
  return toLesson(row);
}

export function getLesson(store: StateStore, id: string): Lesson | null {
  const row = store.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | undefined;
  return row ? toLesson(row) : null;
}

export function listLessons(store: StateStore, filter: { readonly status?: LessonStatus } = {}): Lesson[] {
  const rows = store.db
    .prepare(`SELECT * FROM lessons WHERE (? IS NULL OR status = ?) ORDER BY created_at, id`)
    .all(filter.status ?? null, filter.status ?? null) as unknown as LessonRow[];
  return rows.map(toLesson);
}

/**
 * Advance a lesson one step. Approval and admission name the person or the
 * policy that allowed them; a run passes only checks, never approval.
 */
export function advanceLesson(
  store: StateStore,
  input: {
    readonly id: string;
    readonly to: LessonStatus;
    readonly by: string;
    readonly at: string;
    readonly supersededBy?: string;
  },
): Lesson {
  requireOneOf(input.to, LESSON_STATUSES, 'lesson.status');
  requireNonEmpty(input.by, 'lesson.by');
  requireInstant(input.at, 'lesson.at');
  return store.transaction(() => {
    const current = getLesson(store, input.id);
    if (!current) throw new Error(`no lesson ${input.id}`);
    assertTransition(LESSON_TRANSITIONS, `lesson ${input.id}`, current.status, input.to);
    if (input.to === 'superseded') {
      if (!input.supersededBy) throw new Error('superseding a lesson names its successor');
      if (!getLesson(store, input.supersededBy)) throw new Error(`no lesson ${input.supersededBy} to supersede with`);
    }
    store.db
      .prepare('UPDATE lessons SET status = ?, superseded_by = ?, updated_at = ? WHERE id = ?')
      .run(input.to, input.supersededBy ?? null, input.at, input.id);
    appendActivity(store, {
      at: input.at,
      kind: 'lesson.status',
      runId: current.runId,
      actor: input.by,
      payload: { lessonId: input.id, from: current.status, to: input.to },
    });
    return getLesson(store, input.id)!;
  });
}
