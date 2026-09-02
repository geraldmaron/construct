/**
 * kernel/source/org.ts — the organization as evidence, not as an org chart.
 *
 * Formal structure (an HRIS reporting line), declared ownership (a CODEOWNERS
 * line), and observed collaboration (who reviews whose changes) are kept as
 * distinct bases. Ownership, reporting lines, and membership read from any
 * source are proposals until a person confirms them.
 */

import type { StateStore } from '../state/open.ts';
import {
  addRelation,
  listRelations,
  setRelationStatus,
  CONFIRMATION_REQUIRED_RELATIONS,
  type Relation,
  type RelationBasis,
  type RelationKind,
} from '../state/graph.ts';
import { appendActivity } from '../state/activity.ts';

export interface ProposeOrgRelationInput {
  readonly id: string;
  readonly kind: RelationKind;
  readonly fromId: string;
  readonly toId: string;
  readonly basis: RelationBasis;
  readonly confidence: number;
  readonly sourceId: string;
  readonly at: string;
}

/** Record what a source says about who relates to whom. Always a proposal. */
export function proposeOrgRelation(store: StateStore, input: ProposeOrgRelationInput): Relation {
  return addRelation(store, { ...input, confirmed: false });
}

/** A person confirms a proposed relation. Recorded with who confirmed it. */
export function confirmOrgRelation(store: StateStore, input: { readonly id: string; readonly by: string; readonly at: string }): Relation {
  return store.transaction(() => {
    const relation = setRelationStatus(store, input.id, 'confirmed');
    appendActivity(store, {
      at: input.at,
      kind: 'relation.confirmed',
      actor: input.by,
      payload: { relationId: relation.id, kind: relation.kind, fromId: relation.fromId, toId: relation.toId },
    });
    return relation;
  });
}

export function retireOrgRelation(store: StateStore, input: { readonly id: string; readonly by: string; readonly at: string }): Relation {
  return store.transaction(() => {
    const relation = setRelationStatus(store, input.id, 'retired');
    appendActivity(store, {
      at: input.at,
      kind: 'relation.retired',
      actor: input.by,
      payload: { relationId: relation.id, kind: relation.kind },
    });
    return relation;
  });
}

export interface OrgView {
  readonly entityId: string;
  readonly formal: readonly Relation[];
  readonly declared: readonly Relation[];
  readonly observed: readonly Relation[];
  readonly inferred: readonly Relation[];
  /** Relations still waiting for a person, in the order they were proposed. */
  readonly awaitingConfirmation: readonly Relation[];
}

/** Every live relation touching an entity, bucketed by the kind of evidence behind it. */
export function orgView(store: StateStore, entityId: string): OrgView {
  const touching = [
    ...listRelations(store, { fromId: entityId }),
    ...listRelations(store, { toId: entityId }).filter((r) => r.fromId !== entityId),
  ].filter((r) => r.status !== 'retired');
  const by = (basis: RelationBasis) => touching.filter((r) => r.basis === basis);
  return {
    entityId,
    formal: by('formal'),
    declared: by('declared'),
    observed: by('observed'),
    inferred: by('inferred'),
    awaitingConfirmation: touching.filter(
      (r) => r.status === 'proposed' && CONFIRMATION_REQUIRED_RELATIONS.includes(r.kind),
    ),
  };
}

/** Confirmed owners of an entity; proposals never count. */
export function confirmedOwners(store: StateStore, entityId: string): Relation[] {
  return listRelations(store, { kind: 'owned_by', fromId: entityId, status: 'confirmed' });
}
