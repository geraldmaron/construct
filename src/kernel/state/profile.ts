/**
 * kernel/state/profile.ts — the project profile and its constitution statements.
 *
 * The profile is one row whose onboarding state says how much a person has
 * confirmed. Statements are the constitution's principles, constraints,
 * measures, glossary, unknowns — and the remembered decisions and notes,
 * which are the smallest record Construct can hold.
 */

import type { StateStore } from './open.ts';
import {
  assertTransition,
  requireInstant,
  requireNonEmpty,
  requireOneOf,
} from './rows.ts';

export const PROJECT_SCALES = ['solo', 'side_project', 'team', 'multi_team', 'organization'] as const;
export type ProjectScale = (typeof PROJECT_SCALES)[number];

export const ONBOARDING_STATES = ['incomplete', 'drafted', 'confirmed'] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export interface ProjectProfile {
  readonly name: string | null;
  readonly purpose: string | null;
  readonly scale: ProjectScale | null;
  readonly lifecycleStage: string | null;
  readonly primaryOutcome: string | null;
  readonly riskPosture: string | null;
  readonly reviewCadence: string | null;
  readonly onboardingState: OnboardingState;
  readonly updatedAt: string;
}

interface ProfileRow {
  readonly name: string | null;
  readonly purpose: string | null;
  readonly scale: ProjectScale | null;
  readonly lifecycle_stage: string | null;
  readonly primary_outcome: string | null;
  readonly risk_posture: string | null;
  readonly review_cadence: string | null;
  readonly onboarding_state: OnboardingState;
  readonly updated_at: string;
}

function toProfile(row: ProfileRow): ProjectProfile {
  return {
    name: row.name,
    purpose: row.purpose,
    scale: row.scale,
    lifecycleStage: row.lifecycle_stage,
    primaryOutcome: row.primary_outcome,
    riskPosture: row.risk_posture,
    reviewCadence: row.review_cadence,
    onboardingState: row.onboarding_state,
    updatedAt: row.updated_at,
  };
}

export function getProfile(store: StateStore): ProjectProfile | null {
  const row = store.db.prepare('SELECT * FROM project_profile WHERE id = 1').get() as
    | ProfileRow
    | undefined;
  return row ? toProfile(row) : null;
}

export type ProfilePatch = Partial<Omit<ProjectProfile, 'updatedAt' | 'onboardingState'>> & {
  readonly onboardingState?: OnboardingState;
};

/** Create or update the single profile row. Omitted fields are kept. */
export function upsertProfile(
  store: StateStore,
  patch: ProfilePatch,
  at: string,
): ProjectProfile {
  requireInstant(at, 'profile.at');
  if (patch.scale !== undefined && patch.scale !== null) {
    requireOneOf(patch.scale, PROJECT_SCALES, 'profile.scale');
  }
  if (patch.onboardingState !== undefined) {
    requireOneOf(patch.onboardingState, ONBOARDING_STATES, 'profile.onboardingState');
  }
  return store.transaction(() => {
    const current = getProfile(store);
    const next: ProjectProfile = {
      name: patch.name ?? current?.name ?? null,
      purpose: patch.purpose ?? current?.purpose ?? null,
      scale: patch.scale ?? current?.scale ?? null,
      lifecycleStage: patch.lifecycleStage ?? current?.lifecycleStage ?? null,
      primaryOutcome: patch.primaryOutcome ?? current?.primaryOutcome ?? null,
      riskPosture: patch.riskPosture ?? current?.riskPosture ?? null,
      reviewCadence: patch.reviewCadence ?? current?.reviewCadence ?? null,
      onboardingState: patch.onboardingState ?? current?.onboardingState ?? 'incomplete',
      updatedAt: at,
    };
    store.db
      .prepare(
        `INSERT INTO project_profile
           (id, name, purpose, scale, lifecycle_stage, primary_outcome, risk_posture, review_cadence, onboarding_state, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, purpose = excluded.purpose, scale = excluded.scale,
           lifecycle_stage = excluded.lifecycle_stage, primary_outcome = excluded.primary_outcome,
           risk_posture = excluded.risk_posture, review_cadence = excluded.review_cadence,
           onboarding_state = excluded.onboarding_state, updated_at = excluded.updated_at`,
      )
      .run(
        next.name,
        next.purpose,
        next.scale,
        next.lifecycleStage,
        next.primaryOutcome,
        next.riskPosture,
        next.reviewCadence,
        next.onboardingState,
        next.updatedAt,
      );
    return next;
  });
}

/** Fields a complete profile needs before onboarding can be called done. */
export const PROFILE_REQUIRED_FIELDS = ['name', 'purpose', 'scale', 'primaryOutcome'] as const;

export function missingProfileFields(profile: ProjectProfile | null): string[] {
  if (!profile) return [...PROFILE_REQUIRED_FIELDS];
  return PROFILE_REQUIRED_FIELDS.filter((field) => profile[field] === null);
}

export const STATEMENT_KINDS = [
  'principle',
  'constraint',
  'non_goal',
  'success_measure',
  'invariant',
  'glossary_entry',
  'unknown',
  'decision',
  'note',
  'outcome',
  'canonical_artifact',
  'ownership',
  'boundary',
] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export const STATEMENT_STATUSES = ['proposed', 'confirmed', 'superseded', 'retired'] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export const STATEMENT_PROVENANCES = ['user', 'discovery', 'workflow'] as const;
export type StatementProvenance = (typeof STATEMENT_PROVENANCES)[number];

const STATEMENT_TRANSITIONS: Readonly<Record<StatementStatus, readonly StatementStatus[]>> = {
  proposed: ['confirmed', 'retired', 'superseded'],
  confirmed: ['superseded', 'retired'],
  superseded: [],
  retired: [],
};

export interface Statement {
  readonly id: string;
  readonly kind: StatementKind;
  readonly text: string;
  readonly term: string | null;
  readonly status: StatementStatus;
  readonly provenance: StatementProvenance;
  readonly sourceId: string | null;
  readonly runId: string | null;
  readonly supersededBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface StatementRow {
  readonly id: string;
  readonly kind: StatementKind;
  readonly text: string;
  readonly term: string | null;
  readonly status: StatementStatus;
  readonly provenance: StatementProvenance;
  readonly source_id: string | null;
  readonly run_id: string | null;
  readonly superseded_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function toStatement(row: StatementRow): Statement {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    term: row.term,
    status: row.status,
    provenance: row.provenance,
    sourceId: row.source_id,
    runId: row.run_id,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Add a statement. What a person says is confirmed on arrival; what
 * discovery or a workflow infers is only ever proposed.
 */
export function addStatement(
  store: StateStore,
  input: {
    readonly id: string;
    readonly kind: StatementKind;
    readonly text: string;
    readonly term?: string;
    readonly provenance: StatementProvenance;
    readonly sourceId?: string;
    readonly runId?: string;
    readonly at: string;
  },
): Statement {
  requireNonEmpty(input.id, 'statement.id');
  requireOneOf(input.kind, STATEMENT_KINDS, 'statement.kind');
  requireNonEmpty(input.text, 'statement.text');
  requireOneOf(input.provenance, STATEMENT_PROVENANCES, 'statement.provenance');
  requireInstant(input.at, 'statement.at');
  if (input.kind === 'glossary_entry' && !input.term?.trim()) {
    throw new Error('a glossary_entry statement needs a term');
  }
  const status: StatementStatus = input.provenance === 'user' ? 'confirmed' : 'proposed';
  const row = store.db
    .prepare(
      `INSERT INTO statements
         (id, kind, text, term, status, provenance, source_id, run_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      input.id,
      input.kind,
      input.text,
      input.term ?? null,
      status,
      input.provenance,
      input.sourceId ?? null,
      input.runId ?? null,
      input.at,
      input.at,
    ) as unknown as StatementRow;
  return toStatement(row);
}

export function getStatement(store: StateStore, id: string): Statement | null {
  const row = store.db.prepare('SELECT * FROM statements WHERE id = ?').get(id) as
    | StatementRow
    | undefined;
  return row ? toStatement(row) : null;
}

export function listStatements(
  store: StateStore,
  filter: { readonly kind?: StatementKind; readonly status?: StatementStatus } = {},
): Statement[] {
  const rows = store.db
    .prepare(
      `SELECT * FROM statements
        WHERE (? IS NULL OR kind = ?) AND (? IS NULL OR status = ?)
        ORDER BY created_at, id`,
    )
    .all(
      filter.kind ?? null,
      filter.kind ?? null,
      filter.status ?? null,
      filter.status ?? null,
    ) as unknown as StatementRow[];
  return rows.map(toStatement);
}

/** Move a statement's status; only a person confirms a proposal. */
export function setStatementStatus(
  store: StateStore,
  input: {
    readonly id: string;
    readonly status: StatementStatus;
    readonly at: string;
    readonly supersededBy?: string;
  },
): Statement {
  requireOneOf(input.status, STATEMENT_STATUSES, 'statement.status');
  requireInstant(input.at, 'statement.at');
  return store.transaction(() => {
    const current = getStatement(store, input.id);
    if (!current) throw new Error(`no statement ${input.id}`);
    assertTransition(STATEMENT_TRANSITIONS, `statement ${input.id}`, current.status, input.status);
    if (input.status === 'superseded') {
      if (!input.supersededBy) throw new Error('superseding a statement names its successor');
      if (!getStatement(store, input.supersededBy)) {
        throw new Error(`no statement ${input.supersededBy} to supersede with`);
      }
    }
    store.db
      .prepare(
        `UPDATE statements SET status = ?, superseded_by = ?, updated_at = ? WHERE id = ?`,
      )
      .run(input.status, input.supersededBy ?? null, input.at, input.id);
    return getStatement(store, input.id)!;
  });
}
