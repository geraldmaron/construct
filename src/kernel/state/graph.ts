/**
 * kernel/state/graph.ts — entities, typed relations, and claims with provenance.
 *
 * A relation is refused unless its kind allows the entity kinds at both ends.
 * A claim always says where it came from, how authoritative that is, and how
 * sure we are; it moves observed/inferred → confirmed → superseded and never
 * silently becomes fact.
 */

import type { StateStore } from './open.ts';
import {
  assertTransition,
  parseJson,
  requireInstant,
  requireNonEmpty,
  requireOneOf,
  requireUnitInterval,
  toJson,
} from './rows.ts';
import { AUTHORITY_LEVELS, SENSITIVITIES, type AuthorityLevel, type Sensitivity } from './sources.ts';

export const ENTITY_KINDS = [
  'artifact',
  'system',
  'person',
  'team',
  'initiative',
  'requirement',
  'work_item',
  'code_component',
  'test',
  'metric',
  'decision',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_STATUSES = ['active', 'superseded', 'retired'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly externalRef: string | null;
  readonly attributes: unknown;
  readonly status: EntityStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface EntityRow {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly external_ref: string | null;
  readonly attributes_json: string | null;
  readonly status: EntityStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

function toEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    externalRef: row.external_ref,
    attributes: parseJson(row.attributes_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function addEntity(
  store: StateStore,
  input: {
    readonly id: string;
    readonly kind: EntityKind;
    readonly name: string;
    readonly externalRef?: string;
    readonly attributes?: unknown;
    readonly at: string;
  },
): Entity {
  requireNonEmpty(input.id, 'entity.id');
  requireOneOf(input.kind, ENTITY_KINDS, 'entity.kind');
  requireNonEmpty(input.name, 'entity.name');
  requireInstant(input.at, 'entity.at');
  const row = store.db
    .prepare(
      `INSERT INTO entities (id, kind, name, external_ref, attributes_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?) RETURNING *`,
    )
    .get(
      input.id,
      input.kind,
      input.name,
      input.externalRef ?? null,
      input.attributes === undefined ? null : toJson(input.attributes),
      input.at,
      input.at,
    ) as unknown as EntityRow;
  return toEntity(row);
}

export function getEntity(store: StateStore, id: string): Entity | null {
  const row = store.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as
    | EntityRow
    | undefined;
  return row ? toEntity(row) : null;
}

export function findEntityByRef(
  store: StateStore,
  kind: EntityKind,
  externalRef: string,
): Entity | null {
  const row = store.db
    .prepare('SELECT * FROM entities WHERE kind = ? AND external_ref = ?')
    .get(kind, externalRef) as EntityRow | undefined;
  return row ? toEntity(row) : null;
}

export function listEntities(
  store: StateStore,
  filter: { readonly kind?: EntityKind; readonly status?: EntityStatus; readonly limit?: number } = {},
): Entity[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 500, 5000));
  const rows = store.db
    .prepare(
      `SELECT * FROM entities
        WHERE (? IS NULL OR kind = ?) AND (? IS NULL OR status = ?)
        ORDER BY created_at, id LIMIT ?`,
    )
    .all(
      filter.kind ?? null,
      filter.kind ?? null,
      filter.status ?? null,
      filter.status ?? null,
      limit,
    ) as unknown as EntityRow[];
  return rows.map(toEntity);
}

export function setEntityStatus(
  store: StateStore,
  id: string,
  status: EntityStatus,
  at: string,
): Entity {
  requireOneOf(status, ENTITY_STATUSES, 'entity.status');
  requireInstant(at, 'entity.at');
  const result = store.db
    .prepare('UPDATE entities SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, at, id);
  if (result.changes === 0) throw new Error(`no entity ${id}`);
  return getEntity(store, id)!;
}

export const RELATION_KINDS = [
  'governs',
  'implements',
  'verifies',
  'depends_on',
  'feeds',
  'supersedes',
  'contradicts',
  'owned_by',
  'contributes_to',
  'sourced_from',
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const RELATION_BASES = ['formal', 'declared', 'observed', 'inferred'] as const;
export type RelationBasis = (typeof RELATION_BASES)[number];

export const RELATION_STATUSES = ['proposed', 'confirmed', 'retired'] as const;
export type RelationStatus = (typeof RELATION_STATUSES)[number];

const WORK: readonly EntityKind[] = [
  'artifact',
  'system',
  'initiative',
  'requirement',
  'work_item',
  'code_component',
  'test',
  'metric',
  'decision',
];
const OWNABLE: readonly EntityKind[] = [
  'artifact',
  'system',
  'initiative',
  'requirement',
  'work_item',
  'code_component',
  'test',
  'metric',
];

/** Which entity kinds each relation may connect. Anything else is nonsense. */
export const RELATION_ENDPOINTS: Readonly<
  Record<RelationKind, { readonly from: readonly EntityKind[]; readonly to: readonly EntityKind[]; readonly sameKind?: true }>
> = {
  governs: {
    from: ['artifact', 'decision', 'requirement'],
    to: ['artifact', 'system', 'initiative', 'requirement', 'work_item', 'code_component'],
  },
  implements: {
    from: ['code_component', 'work_item', 'artifact', 'system'],
    to: ['requirement', 'decision', 'initiative'],
  },
  verifies: {
    from: ['test', 'metric'],
    to: ['requirement', 'code_component', 'decision', 'initiative', 'system'],
  },
  depends_on: { from: WORK, to: WORK },
  feeds: {
    from: ['system', 'metric', 'artifact', 'code_component'],
    to: ['system', 'metric', 'artifact', 'initiative'],
  },
  supersedes: { from: ENTITY_KINDS, to: ENTITY_KINDS, sameKind: true },
  contradicts: {
    from: ['artifact', 'decision', 'requirement', 'code_component'],
    to: ['artifact', 'decision', 'requirement', 'code_component'],
  },
  owned_by: { from: OWNABLE, to: ['person', 'team'] },
  contributes_to: {
    from: ['work_item', 'initiative', 'code_component', 'person', 'team'],
    to: ['initiative', 'metric'],
  },
  sourced_from: { from: ENTITY_KINDS, to: ['artifact', 'system'] },
};

export interface Relation {
  readonly id: string;
  readonly kind: RelationKind;
  readonly fromId: string;
  readonly toId: string;
  readonly basis: RelationBasis;
  readonly confidence: number;
  readonly sourceId: string | null;
  readonly status: RelationStatus;
  readonly createdAt: string;
}

interface RelationRow {
  readonly id: string;
  readonly kind: RelationKind;
  readonly from_id: string;
  readonly to_id: string;
  readonly basis: RelationBasis;
  readonly confidence: number;
  readonly source_id: string | null;
  readonly status: RelationStatus;
  readonly created_at: string;
}

function toRelation(row: RelationRow): Relation {
  return {
    id: row.id,
    kind: row.kind,
    fromId: row.from_id,
    toId: row.to_id,
    basis: row.basis,
    confidence: row.confidence,
    sourceId: row.source_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class InvalidRelationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRelationError';
  }
}

export function validateRelationEndpoints(
  kind: RelationKind,
  from: Entity,
  to: Entity,
): void {
  if (from.id === to.id) {
    throw new InvalidRelationError(`an entity cannot ${kind} itself (${from.id})`);
  }
  const rule = RELATION_ENDPOINTS[kind];
  if (!rule.from.includes(from.kind)) {
    throw new InvalidRelationError(`a ${from.kind} cannot be the subject of ${kind}`);
  }
  if (!rule.to.includes(to.kind)) {
    throw new InvalidRelationError(`a ${to.kind} cannot be the object of ${kind}`);
  }
  if (rule.sameKind && from.kind !== to.kind) {
    throw new InvalidRelationError(`${kind} joins two entities of one kind (${from.kind} vs ${to.kind})`);
  }
}

/**
 * Add a relation. Formal and declared relations from a person are confirmed;
 * observed and inferred ones are proposed until someone confirms them —
 * ownership and reporting lines never promote themselves.
 */
export function addRelation(
  store: StateStore,
  input: {
    readonly id: string;
    readonly kind: RelationKind;
    readonly fromId: string;
    readonly toId: string;
    readonly basis: RelationBasis;
    readonly confidence: number;
    readonly sourceId?: string;
    readonly confirmed?: boolean;
    readonly at: string;
  },
): Relation {
  requireNonEmpty(input.id, 'relation.id');
  requireOneOf(input.kind, RELATION_KINDS, 'relation.kind');
  requireOneOf(input.basis, RELATION_BASES, 'relation.basis');
  requireUnitInterval(input.confidence, 'relation.confidence');
  requireInstant(input.at, 'relation.at');
  return store.transaction(() => {
    const from = getEntity(store, input.fromId);
    const to = getEntity(store, input.toId);
    if (!from) throw new InvalidRelationError(`no entity ${input.fromId}`);
    if (!to) throw new InvalidRelationError(`no entity ${input.toId}`);
    validateRelationEndpoints(input.kind, from, to);
    const inferred = input.basis === 'observed' || input.basis === 'inferred';
    if (input.confirmed && inferred) {
      throw new InvalidRelationError(
        `an ${input.basis} ${input.kind} relation is proposed, not confirmed; confirm it separately`,
      );
    }
    const status: RelationStatus = inferred ? 'proposed' : input.confirmed ? 'confirmed' : 'proposed';
    const row = store.db
      .prepare(
        `INSERT INTO relations (id, kind, from_id, to_id, basis, confidence, source_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        input.id,
        input.kind,
        input.fromId,
        input.toId,
        input.basis,
        input.confidence,
        input.sourceId ?? null,
        status,
        input.at,
      ) as unknown as RelationRow;
    return toRelation(row);
  });
}

export function setRelationStatus(
  store: StateStore,
  id: string,
  status: RelationStatus,
): Relation {
  requireOneOf(status, RELATION_STATUSES, 'relation.status');
  const result = store.db.prepare('UPDATE relations SET status = ? WHERE id = ?').run(status, id);
  if (result.changes === 0) throw new Error(`no relation ${id}`);
  const row = store.db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as unknown as RelationRow;
  return toRelation(row);
}

export function listRelations(
  store: StateStore,
  filter: {
    readonly kind?: RelationKind;
    readonly fromId?: string;
    readonly toId?: string;
    readonly status?: RelationStatus;
  } = {},
): Relation[] {
  const rows = store.db
    .prepare(
      `SELECT * FROM relations
        WHERE (? IS NULL OR kind = ?) AND (? IS NULL OR from_id = ?)
          AND (? IS NULL OR to_id = ?) AND (? IS NULL OR status = ?)
        ORDER BY created_at, id`,
    )
    .all(
      filter.kind ?? null,
      filter.kind ?? null,
      filter.fromId ?? null,
      filter.fromId ?? null,
      filter.toId ?? null,
      filter.toId ?? null,
      filter.status ?? null,
      filter.status ?? null,
    ) as unknown as RelationRow[];
  return rows.map(toRelation);
}

export const CLAIM_STATUSES = ['observed', 'inferred', 'confirmed', 'superseded'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_PROVENANCES = ['user', 'source', 'discovery', 'workflow'] as const;
export type ClaimProvenance = (typeof CLAIM_PROVENANCES)[number];

const CLAIM_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  observed: ['confirmed', 'superseded'],
  inferred: ['confirmed', 'superseded'],
  confirmed: ['superseded'],
  superseded: [],
};

export interface Claim {
  readonly id: string;
  readonly subjectId: string;
  readonly claimType: string;
  readonly statement: string;
  readonly value: unknown;
  readonly sourceId: string | null;
  readonly provenance: ClaimProvenance;
  readonly authority: AuthorityLevel;
  readonly sensitivity: Sensitivity;
  readonly confidence: number;
  readonly status: ClaimStatus;
  readonly observedAt: string;
  readonly freshUntil: string | null;
  readonly supersededBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ClaimRow {
  readonly id: string;
  readonly subject_id: string;
  readonly claim_type: string;
  readonly statement: string;
  readonly value_json: string | null;
  readonly source_id: string | null;
  readonly provenance: ClaimProvenance;
  readonly authority: AuthorityLevel;
  readonly sensitivity: Sensitivity;
  readonly confidence: number;
  readonly status: ClaimStatus;
  readonly observed_at: string;
  readonly fresh_until: string | null;
  readonly superseded_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function toClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    subjectId: row.subject_id,
    claimType: row.claim_type,
    statement: row.statement,
    value: parseJson(row.value_json),
    sourceId: row.source_id,
    provenance: row.provenance,
    authority: row.authority,
    sensitivity: row.sensitivity,
    confidence: row.confidence,
    status: row.status,
    observedAt: row.observed_at,
    freshUntil: row.fresh_until,
    supersededBy: row.superseded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Add a claim. Its starting status follows its provenance: a person's word is
 * confirmed, a source read is observed, discovery and workflow output are
 * inferred. Nothing else can mint a confirmed claim.
 */
export function addClaim(
  store: StateStore,
  input: {
    readonly id: string;
    readonly subjectId: string;
    readonly claimType: string;
    readonly statement: string;
    readonly value?: unknown;
    readonly sourceId?: string;
    readonly provenance: ClaimProvenance;
    readonly authority: AuthorityLevel;
    readonly sensitivity: Sensitivity;
    readonly confidence: number;
    readonly observedAt: string;
    readonly freshUntil?: string;
    readonly at: string;
  },
): Claim {
  requireNonEmpty(input.id, 'claim.id');
  requireNonEmpty(input.claimType, 'claim.claimType');
  requireNonEmpty(input.statement, 'claim.statement');
  requireOneOf(input.provenance, CLAIM_PROVENANCES, 'claim.provenance');
  requireOneOf(input.authority, AUTHORITY_LEVELS, 'claim.authority');
  requireOneOf(input.sensitivity, SENSITIVITIES, 'claim.sensitivity');
  requireUnitInterval(input.confidence, 'claim.confidence');
  requireInstant(input.observedAt, 'claim.observedAt');
  requireInstant(input.at, 'claim.at');
  if (input.freshUntil !== undefined) requireInstant(input.freshUntil, 'claim.freshUntil');
  const status: ClaimStatus =
    input.provenance === 'user' ? 'confirmed' : input.provenance === 'source' ? 'observed' : 'inferred';
  const row = store.db
    .prepare(
      `INSERT INTO claims
         (id, subject_id, claim_type, statement, value_json, source_id, provenance, authority,
          sensitivity, confidence, status, observed_at, fresh_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      input.id,
      input.subjectId,
      input.claimType,
      input.statement,
      input.value === undefined ? null : toJson(input.value),
      input.sourceId ?? null,
      input.provenance,
      input.authority,
      input.sensitivity,
      input.confidence,
      status,
      input.observedAt,
      input.freshUntil ?? null,
      input.at,
      input.at,
    ) as unknown as ClaimRow;
  return toClaim(row);
}

export function getClaim(store: StateStore, id: string): Claim | null {
  const row = store.db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as ClaimRow | undefined;
  return row ? toClaim(row) : null;
}

export function listClaims(
  store: StateStore,
  filter: {
    readonly subjectId?: string;
    readonly claimType?: string;
    readonly status?: ClaimStatus;
    readonly sourceId?: string;
  } = {},
): Claim[] {
  const rows = store.db
    .prepare(
      `SELECT * FROM claims
        WHERE (? IS NULL OR subject_id = ?) AND (? IS NULL OR claim_type = ?)
          AND (? IS NULL OR status = ?) AND (? IS NULL OR source_id = ?)
        ORDER BY created_at, id`,
    )
    .all(
      filter.subjectId ?? null,
      filter.subjectId ?? null,
      filter.claimType ?? null,
      filter.claimType ?? null,
      filter.status ?? null,
      filter.status ?? null,
      filter.sourceId ?? null,
      filter.sourceId ?? null,
    ) as unknown as ClaimRow[];
  return rows.map(toClaim);
}

export function confirmClaim(store: StateStore, id: string, at: string): Claim {
  requireInstant(at, 'claim.at');
  return store.transaction(() => {
    const current = getClaim(store, id);
    if (!current) throw new Error(`no claim ${id}`);
    assertTransition(CLAIM_TRANSITIONS, `claim ${id}`, current.status, 'confirmed');
    store.db
      .prepare(`UPDATE claims SET status = 'confirmed', updated_at = ? WHERE id = ?`)
      .run(at, id);
    return getClaim(store, id)!;
  });
}

export function supersedeClaim(
  store: StateStore,
  input: { readonly id: string; readonly by: string; readonly at: string },
): Claim {
  requireInstant(input.at, 'claim.at');
  return store.transaction(() => {
    const current = getClaim(store, input.id);
    if (!current) throw new Error(`no claim ${input.id}`);
    if (!getClaim(store, input.by)) throw new Error(`no claim ${input.by} to supersede with`);
    assertTransition(CLAIM_TRANSITIONS, `claim ${input.id}`, current.status, 'superseded');
    store.db
      .prepare(`UPDATE claims SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?`)
      .run(input.by, input.at, input.id);
    return getClaim(store, input.id)!;
  });
}

/** Live claims whose freshness window has passed at `at`. */
export function staleClaims(store: StateStore, at: string): Claim[] {
  requireInstant(at, 'claims.at');
  const rows = store.db
    .prepare(
      `SELECT * FROM claims
        WHERE status <> 'superseded' AND fresh_until IS NOT NULL AND fresh_until < ?
        ORDER BY fresh_until, id`,
    )
    .all(at) as unknown as ClaimRow[];
  return rows.map(toClaim);
}
