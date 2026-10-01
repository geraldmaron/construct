/**
 * kernel/state/admission.ts — how governing statements and work enter the graph.
 *
 * A remembered decision, constraint, principle, outcome, or invariant is a
 * live entity. A note is not. Work is admitted only with a parent that gives
 * it a reason to exist. Observations never become work here.
 */

import type { StateStore } from './open.ts';
import {
  addEntity,
  addRelation,
  findEntityByRef,
  getEntity,
  listRelations,
  setEntityStatus,
  type Entity,
  type EntityKind,
} from './graph.ts';
import {
  getStatement,
  setStatementStatus,
  type Statement,
  type StatementKind,
} from './profile.ts';

export const GOVERNING_STATEMENT_KINDS = ['decision', 'constraint', 'principle', 'outcome', 'invariant'] as const;
export type GoverningStatementKind = (typeof GOVERNING_STATEMENT_KINDS)[number];

export function isGoverningKind(kind: StatementKind): kind is GoverningStatementKind {
  return (GOVERNING_STATEMENT_KINDS as readonly string[]).includes(kind);
}

export function entityKindForStatement(kind: StatementKind): 'decision' | 'initiative' | null {
  if (!isGoverningKind(kind)) return null;
  return kind === 'outcome' ? 'initiative' : 'decision';
}

export function statementRef(statementId: string): string {
  return `statement:${statementId}`;
}

/** Mint or return the graph entity that carries a governing statement. Notes return null. */
export function bindGoverningStatement(
  store: StateStore,
  statement: Statement,
  at: string,
  nextId: (prefix: string) => string,
): Entity | null {
  const kind = entityKindForStatement(statement.kind);
  if (!kind) return null;
  const ref = statementRef(statement.id);
  const existing = findEntityByRef(store, kind, ref);
  if (existing) return existing;
  return addEntity(store, {
    id: nextId('ent'),
    kind,
    name: statement.text.length > 120 ? `${statement.text.slice(0, 117)}...` : statement.text,
    externalRef: ref,
    attributes: {
      statementKind: statement.kind,
      locator: statement.locator,
      span: statement.span,
      excerpt: statement.excerpt,
      sourceRevision: statement.sourceRevision,
      extractorVersion: statement.extractorVersion,
      contentDigest: statement.contentDigest,
      quoted: statement.quoted,
    },
    at,
  });
}

/** The newer statement replaces the older. History stays; the older entity is superseded. */
export function supersedeGoverning(
  store: StateStore,
  input: {
    readonly olderId: string;
    readonly successor: Statement;
    readonly at: string;
    readonly nextId: (prefix: string) => string;
  },
): Entity | null {
  const older = getStatement(store, input.olderId);
  if (!older) throw new Error(`no statement ${input.olderId}`);
  setStatementStatus(store, { id: input.olderId, status: 'superseded', at: input.at, supersededBy: input.successor.id });
  const oldKind = entityKindForStatement(older.kind);
  const newKind = entityKindForStatement(input.successor.kind);
  const successor = bindGoverningStatement(store, input.successor, input.at, input.nextId);
  if (!oldKind || !newKind || oldKind !== newKind || !successor) return successor;
  const olderEntity = findEntityByRef(store, oldKind, statementRef(older.id));
  if (!olderEntity) return successor;
  setEntityStatus(store, olderEntity.id, 'superseded', input.at);
  addRelation(store, {
    id: input.nextId('rel'),
    kind: 'supersedes',
    fromId: successor.id,
    toId: olderEntity.id,
    basis: 'declared',
    confidence: 1,
    confirmed: true,
    at: input.at,
  });
  return successor;
}

const WORK_PARENTS: readonly EntityKind[] = ['decision', 'requirement', 'initiative', 'metric'];

/**
 * The graph entity a work item names as its reason to exist: an active
 * decision, requirement, initiative, or metric, by entity id or by the id of
 * the governing statement that minted it. Anything else is refused.
 */
export function resolveWorkReason(store: StateStore, id: string): Entity {
  let reason = getEntity(store, id);
  if (!reason) {
    const statement = getStatement(store, id);
    if (statement) {
      const kind = entityKindForStatement(statement.kind);
      reason = kind ? findEntityByRef(store, kind, statementRef(statement.id)) : null;
      if (!reason) {
        throw new Error(
          statement.status === 'confirmed' || !kind
            ? `statement ${id} is a ${statement.kind}, which is not a reason for work; name a decision, requirement, initiative, or metric`
            : `statement ${id} is still ${statement.status}; confirm it before work serves it`,
        );
      }
    }
  }
  if (!reason) throw new Error(`no parent ${id}: name an active decision, requirement, initiative, or metric`);
  if (reason.status !== 'active') throw new Error(`"${reason.name}" is not an active reason for work`);
  if (!WORK_PARENTS.includes(reason.kind)) {
    throw new Error('a work item names the decision, requirement, initiative, or metric it serves');
  }
  return reason;
}

/** Record that a work item's entity serves `reason`: it implements a decision, requirement, or initiative, or contributes to a metric. */
export function linkWorkToReason(
  store: StateStore,
  input: { readonly workEntityId: string; readonly reason: Entity; readonly relationId: string; readonly at: string },
): void {
  const kind = input.reason.kind === 'metric' ? 'contributes_to' : 'implements';
  if (listRelations(store, { kind, fromId: input.workEntityId, toId: input.reason.id }).some((r) => r.status !== 'retired')) return;
  addRelation(store, {
    id: input.relationId,
    kind,
    fromId: input.workEntityId,
    toId: input.reason.id,
    basis: 'declared',
    confidence: 1,
    confirmed: true,
    at: input.at,
  });
}

/** The reasons a work item's entity serves, as live relations. */
export function workReasons(store: StateStore, workEntityId: string): readonly Entity[] {
  return listRelations(store, { fromId: workEntityId })
    .filter((r) => (r.kind === 'implements' || r.kind === 'contributes_to') && r.status !== 'retired')
    .map((r) => getEntity(store, r.toId))
    .filter((e): e is Entity => e !== null && e.status === 'active' && WORK_PARENTS.includes(e.kind));
}

/**
 * Admit a work item as a graph entity. It must name an active parent that
 * gives it a reason to exist. Observations, risks, and candidates do not call this.
 */
export function admitWork(
  store: StateStore,
  input: {
    readonly id: string;
    readonly name: string;
    readonly parentId: string;
    readonly relationId: string;
    readonly at: string;
  },
): Entity {
  const parent = resolveWorkReason(store, input.parentId);
  const work = addEntity(store, { id: input.id, kind: 'work_item', name: input.name, at: input.at });
  linkWorkToReason(store, { workEntityId: work.id, reason: parent, relationId: input.relationId, at: input.at });
  return work;
}

/**
 * Active entities that would need reconsideration if `entityId` stopped
 * being a sound governor: what it governs, and what implements, depends
 * on, contributes to, or verifies it. Similarity is not a relation.
 */
export function implicationsOf(store: StateStore, entityId: string): Entity[] {
  const relations = listRelations(store).filter((r) => r.status !== 'retired');
  const seen = new Set<string>();
  const out: Entity[] = [];
  const add = (id: string) => {
    if (seen.has(id) || id === entityId) return;
    const e = getEntity(store, id);
    if (!e || e.status !== 'active') return;
    seen.add(id);
    out.push(e);
  };
  for (const r of relations) {
    if (r.fromId === entityId && (r.kind === 'governs' || r.kind === 'depends_on')) add(r.toId);
    if (r.toId === entityId && (r.kind === 'depends_on' || r.kind === 'implements' || r.kind === 'contributes_to' || r.kind === 'verifies')) {
      add(r.fromId);
    }
  }
  return out;
}
