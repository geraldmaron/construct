/**
 * kernel/store/lessons.ts — the lesson store.
 *
 * Serves commitment 2 (immutable, citation-carrying strata: a lesson
 * supersedes, never rewrites) and commitment 6 as amended 2026-08-03: a lesson
 * belongs to the workspace it was produced in, and serving it anywhere else is
 * an explicit per-lesson user decision.
 *
 * The storage shape is the safety property, not a read-time filter. The
 * amendment exists because the original design made client A's confidential
 * facts part of client B's prompts as the happy path; here that failure is
 * unrepresentable rather than guarded against:
 *
 *   - `workspace` is NOT NULL: a lesson with no workspace is not addressable
 *     by any workspace, because it cannot be stored at all.
 *   - Scoped reads select by workspace equality; there is no read that takes
 *     a list of workspaces or a wildcard.
 *   - Promotion never widens an existing row. It appends a new global-scope
 *     row derived from the original, with quoted spans and citation bodies
 *     stripped by this module — not by the caller's promise to have stripped
 *     them — and refuses every kind except technique and process.
 *   - Consuming globally-promoted lessons requires a recorded consent row.
 *     An absent row is a "no": client and confidential work must not depend
 *     on someone remembering to opt out.
 *
 * Admission (risk tiers, adversarial passes, human review) is a gate over this
 * store, not part of it; provenance is recorded here so that gate can see
 * whether a lesson's source was an ingested external document.
 */

import type { Store } from './open.ts';

export const LESSON_KINDS = ['technique', 'process', 'domain'] as const;

export type LessonKind = (typeof LESSON_KINDS)[number];

/** The kinds commitment 6 permits to leave their workspace. */
export const PROMOTABLE_KINDS: readonly LessonKind[] = ['technique', 'process'];

export interface Lesson {
  readonly id: string;
  readonly workspace: string;
  readonly scope: 'workspace' | 'global';
  readonly kind: LessonKind;
  readonly body: string;
  readonly citation: string;
  /** Whether the cited source was an ingested external document. */
  readonly external: boolean;
  readonly supersedes: string | null;
  readonly promotedFrom: string | null;
  readonly createdAt: string;
}

export interface RecordLesson {
  readonly id: string;
  readonly workspace: string;
  readonly kind: LessonKind;
  readonly body: string;
  readonly citation: string;
  readonly external: boolean;
  readonly supersedes?: string | null;
  /** Injected; the kernel never reads the clock. */
  readonly createdAt: string;
}

interface Row {
  readonly id: string;
  readonly workspace: string;
  readonly scope: string;
  readonly kind: string;
  readonly body: string;
  readonly citation: string;
  readonly external: number;
  readonly supersedes: string | null;
  readonly promoted_from: string | null;
  readonly created_at: string;
}

function toLesson(row: Row): Lesson {
  return {
    id: row.id,
    workspace: row.workspace,
    scope: row.scope as Lesson['scope'],
    kind: row.kind as LessonKind,
    body: row.body,
    citation: row.citation,
    external: row.external === 1,
    supersedes: row.supersedes,
    promotedFrom: row.promoted_from,
    createdAt: row.created_at,
  };
}

/** Record a lesson in its workspace. The only way a lesson enters the store. */
export function recordLesson(store: Store, lesson: RecordLesson): void {
  if (!(LESSON_KINDS as readonly string[]).includes(lesson.kind)) {
    throw new Error(`recordLesson: unknown kind "${lesson.kind}"`);
  }
  if (lesson.workspace.trim() === '') {
    // The NOT NULL column stops a missing workspace; this stops the
    // empty-string way of writing the same unaddressable lesson.
    throw new Error(`recordLesson: ${lesson.id} has no workspace`);
  }
  if (lesson.supersedes) {
    // Supersession hides the older lesson from prompt assembly, so a
    // cross-workspace supersede would be a way for one workspace to silence
    // another's learning. Same workspace, same scope, or it does not happen.
    const target = getLesson(store, lesson.supersedes);
    if (!target) {
      throw new Error(`recordLesson: ${lesson.id} supersedes unknown lesson ${lesson.supersedes}`);
    }
    if (target.scope !== 'workspace' || target.workspace !== lesson.workspace) {
      throw new Error(
        `recordLesson: ${lesson.id} in ${lesson.workspace} may not supersede ${target.id} in ${target.workspace} (${target.scope})`,
      );
    }
  }
  store.db
    .prepare(
      `INSERT INTO lessons (id, workspace, scope, kind, body, citation, external, supersedes, promoted_from, created_at)
       VALUES (?, ?, 'workspace', ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      lesson.id,
      lesson.workspace,
      lesson.kind,
      lesson.body,
      lesson.citation,
      lesson.external ? 1 : 0,
      lesson.supersedes ?? null,
      lesson.createdAt,
    );
}

/**
 * Strip the material that must not travel across workspaces: quoted spans
 * (straight and curly) and the bodies of citation markers. Deterministic and
 * owned by the store so promotion cannot ship a body the caller forgot to
 * clean. What survives is the technique, not the client's words.
 */
export function stripForPromotion(body: string): string {
  return body
    .replace(/"[^"]*"/g, '[stripped]')
    .replace(/“[^”]*”/g, '[stripped]')
    .replace(/\[cite:[^\]]+\]/gi, '[cite:stripped]');
}

/**
 * Promote a lesson to serve all the user's workspaces. Appends a new global
 * row rather than widening the original — the original row's scope never
 * changes, so a promotion cannot be an edit. Refuses non-technique/process
 * kinds and refuses to promote a promotion.
 */
export function promoteLesson(
  store: Store,
  id: string,
  promotedId: string,
  promotedAt: string,
): Lesson {
  const original = getLesson(store, id);
  if (!original) throw new Error(`promoteLesson: no lesson ${id}`);
  if (original.scope !== 'workspace') {
    throw new Error(`promoteLesson: ${id} is already global`);
  }
  if (!PROMOTABLE_KINDS.includes(original.kind)) {
    throw new Error(
      `promoteLesson: ${id} is a ${original.kind} lesson; only technique and process lessons may leave their workspace`,
    );
  }
  store.db
    .prepare(
      `INSERT INTO lessons (id, workspace, scope, kind, body, citation, external, supersedes, promoted_from, created_at)
       VALUES (?, ?, 'global', ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      promotedId,
      original.workspace,
      original.kind,
      stripForPromotion(original.body),
      // The promoted row cites its origin lesson, not the origin's sources:
      // the sources are workspace facts and stay behind.
      `lesson:${original.id}`,
      original.external ? 1 : 0,
      original.id,
      promotedAt,
    );
  const promoted = getLesson(store, promotedId);
  if (!promoted) throw new Error(`promoteLesson: failed to read back ${promotedId}`);
  return promoted;
}

/**
 * Record whether a workspace may consume globally-promoted lessons. An upsert:
 * consent is the one mutable fact here, because it is a user setting rather
 * than evidence.
 */
export function setWorkspaceConsent(
  store: Store,
  workspace: string,
  consumesGlobal: boolean,
  recordedAt: string,
): void {
  store.db
    .prepare(
      `INSERT INTO workspace_consent (workspace, consumes_global, recorded_at)
       VALUES (?, ?, ?)
       ON CONFLICT (workspace) DO UPDATE SET consumes_global = excluded.consumes_global, recorded_at = excluded.recorded_at`,
    )
    .run(workspace, consumesGlobal ? 1 : 0, recordedAt);
}

/** Whether a workspace consumes global lessons. No recorded consent is a no. */
export function workspaceConsumesGlobal(store: Store, workspace: string): boolean {
  const row = store.db
    .prepare('SELECT consumes_global FROM workspace_consent WHERE workspace = ?')
    .get(workspace) as { consumes_global: number } | undefined;
  return row?.consumes_global === 1;
}

/**
 * The lessons a prompt assembler may use for work in `workspace`: that
 * workspace's own lessons, oldest first, plus globally-promoted lessons only
 * when the workspace has recorded consent to consume them. Superseded lessons
 * are excluded from assembly but never from the store.
 */
export function lessonsFor(store: Store, workspace: string): Lesson[] {
  const own = store.db
    .prepare(
      `SELECT * FROM lessons WHERE scope = 'workspace' AND workspace = ?
       AND id NOT IN (SELECT supersedes FROM lessons WHERE supersedes IS NOT NULL)
       ORDER BY created_at, id`,
    )
    .all(workspace) as unknown as Row[];
  const rows = [...own];
  if (workspaceConsumesGlobal(store, workspace)) {
    const global = store.db
      .prepare(
        `SELECT * FROM lessons WHERE scope = 'global'
         AND id NOT IN (SELECT supersedes FROM lessons WHERE supersedes IS NOT NULL)
         ORDER BY created_at, id`,
      )
      .all() as unknown as Row[];
    rows.push(...global);
  }
  return rows.map(toLesson);
}

export function getLesson(store: Store, id: string): Lesson | null {
  const row = store.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as Row | undefined;
  return row ? toLesson(row) : null;
}
