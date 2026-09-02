/**
 * kernel/source/entities.ts — every active source has an entity standing for
 * it in the context graph, so relations can be drawn to and from what a
 * source is (a document collection, a tracker, a directory).
 */

import type { StateStore } from '../state/open.ts';
import { addEntity, findEntityByRef, type Entity, type EntityKind } from '../state/graph.ts';
import { listSources } from '../state/sources.ts';

export function sourceEntityRef(sourceId: string): string {
  return `source:${sourceId}`;
}

export function sourceEntityKind(kind: string): EntityKind {
  return kind === 'docs' || kind === 'directory' ? 'artifact' : 'system';
}

/** The entity for a source, created if it is missing. */
export function ensureSourceEntity(
  store: StateStore,
  input: { readonly sourceId: string; readonly kind: string; readonly name: string; readonly at: string; readonly nextId: (prefix: string) => string },
): Entity {
  const kind = sourceEntityKind(input.kind);
  const existing = findEntityByRef(store, kind, sourceEntityRef(input.sourceId));
  if (existing) return existing;
  return addEntity(store, { id: input.nextId('ent'), kind, name: input.name, externalRef: sourceEntityRef(input.sourceId), at: input.at });
}

export function ensureSourceEntities(store: StateStore, at: string, nextId: (prefix: string) => string): Entity[] {
  return listSources(store, { status: 'active' }).map((s) =>
    ensureSourceEntity(store, { sourceId: s.id, kind: s.kind, name: s.purpose, at, nextId }),
  );
}

export function sourceEntity(store: StateStore, sourceId: string, kind: string): Entity | null {
  return findEntityByRef(store, sourceEntityKind(kind), sourceEntityRef(sourceId));
}
