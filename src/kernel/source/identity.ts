/**
 * kernel/source/identity.ts — who is this, before anything is merged.
 *
 * A candidate from a source matches an entity by external reference, then by
 * email, then by normalized name. One match is a match; several is ambiguous
 * and nothing merges until a person chooses; none is new. Every alias that
 * is admitted is recorded as a claim, so the join can be audited later.
 */

import type { StateStore } from '../state/open.ts';
import { addClaim, addEntity, findEntityByRef, listClaims, listEntities, type Entity, type EntityKind } from '../state/graph.ts';
import { getSource } from '../state/sources.ts';

export interface IdentityCandidate {
  readonly kind: Extract<EntityKind, 'person' | 'team'>;
  readonly sourceId: string;
  readonly externalRef: string;
  readonly name: string;
  readonly email?: string;
}

export type IdentityResolution =
  | { readonly outcome: 'match'; readonly entity: Entity; readonly by: 'external_ref' | 'alias' | 'email' | 'name' }
  | { readonly outcome: 'ambiguous'; readonly entities: readonly Entity[]; readonly by: 'email' | 'name' }
  | { readonly outcome: 'new' };

export class AmbiguousIdentityError extends Error {
  readonly candidates: readonly Entity[];

  constructor(candidate: IdentityCandidate, entities: readonly Entity[]) {
    super(
      `"${candidate.name}" from ${candidate.sourceId} could be ${entities.map((e) => `${e.name} (${e.id})`).join(' or ')}; choose one before merging`,
    );
    this.name = 'AmbiguousIdentityError';
    this.candidates = entities;
  }
}

export const ALIAS_CLAIM_TYPE = 'identity_alias';

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function aliasRef(sourceId: string, externalRef: string): string {
  return `${sourceId}:${externalRef}`;
}

function emailOf(entity: Entity): string | null {
  const attrs = entity.attributes;
  if (attrs && typeof attrs === 'object' && typeof (attrs as { email?: unknown }).email === 'string') {
    return normalizeEmail((attrs as { email: string }).email);
  }
  return null;
}

export function resolveIdentity(store: StateStore, candidate: IdentityCandidate): IdentityResolution {
  const byRef = findEntityByRef(store, candidate.kind, aliasRef(candidate.sourceId, candidate.externalRef));
  if (byRef) return { outcome: 'match', entity: byRef, by: 'external_ref' };

  const alias = listClaims(store, { claimType: ALIAS_CLAIM_TYPE, sourceId: candidate.sourceId }).find(
    (c) => c.status !== 'superseded' && c.value === candidate.externalRef,
  );
  if (alias) {
    const entity = listEntities(store, { kind: candidate.kind }).find((e) => e.id === alias.subjectId);
    if (entity) return { outcome: 'match', entity, by: 'alias' };
  }

  const pool = listEntities(store, { kind: candidate.kind, status: 'active' });
  if (candidate.email) {
    const email = normalizeEmail(candidate.email);
    const byEmail = pool.filter((e) => emailOf(e) === email);
    if (byEmail.length === 1) return { outcome: 'match', entity: byEmail[0]!, by: 'email' };
    if (byEmail.length > 1) return { outcome: 'ambiguous', entities: byEmail, by: 'email' };
  }
  const name = normalizeName(candidate.name);
  const byName = pool.filter((e) => normalizeName(e.name) === name);
  if (byName.length === 1) return { outcome: 'match', entity: byName[0]!, by: 'name' };
  if (byName.length > 1) return { outcome: 'ambiguous', entities: byName, by: 'name' };
  return { outcome: 'new' };
}

export interface AdmitIdentityInput {
  readonly candidate: IdentityCandidate;
  readonly at: string;
  readonly nextId: (prefix: string) => string;
  /** Required when resolution is ambiguous; ignored otherwise. */
  readonly chosenEntityId?: string;
}

/**
 * Admit a candidate: link it to the entity it matched (recording the alias),
 * create it when new, or refuse when ambiguous and no choice was made.
 */
export function admitIdentity(store: StateStore, input: AdmitIdentityInput): { readonly entity: Entity; readonly created: boolean } {
  const { candidate, at, nextId } = input;
  const source = getSource(store, candidate.sourceId);
  if (!source) throw new Error(`no source ${candidate.sourceId}`);
  return store.transaction(() => {
    const resolution = resolveIdentity(store, candidate);
    if (resolution.outcome === 'match' && resolution.by === 'external_ref') return { entity: resolution.entity, created: false };
    let entity: Entity;
    let created = false;
    if (resolution.outcome === 'ambiguous') {
      const chosen = input.chosenEntityId ? resolution.entities.find((e) => e.id === input.chosenEntityId) : undefined;
      if (!chosen) throw new AmbiguousIdentityError(candidate, resolution.entities);
      entity = chosen;
    } else if (resolution.outcome === 'match') {
      entity = resolution.entity;
    } else {
      entity = addEntity(store, {
        id: nextId('ent'),
        kind: candidate.kind,
        name: candidate.name,
        externalRef: aliasRef(candidate.sourceId, candidate.externalRef),
        attributes: candidate.email ? { email: normalizeEmail(candidate.email) } : undefined,
        at,
      });
      created = true;
    }
    if (!created) {
      addClaim(store, {
        id: nextId('claim'),
        subjectId: entity.id,
        claimType: ALIAS_CLAIM_TYPE,
        statement: `${candidate.sourceId} knows ${entity.name} as ${candidate.externalRef}`,
        value: candidate.externalRef,
        sourceId: candidate.sourceId,
        provenance: 'source',
        authority: 'informative',
        sensitivity: source.sensitivity,
        confidence: resolution.outcome === 'match' && resolution.by === 'email' ? 0.9 : 0.6,
        observedAt: at,
        at,
      });
    }
    return { entity, created };
  });
}
