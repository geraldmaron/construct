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
    attributes: { statementKind: statement.kind },
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
 * Admit a work item. It must name an active parent that gives it a reason
 * to exist. Observations, risks, and candidates do not call this.
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
  const parent = getEntity(store, input.parentId);
  if (!parent) throw new Error(`no parent ${input.parentId}`);
  if (parent.status !== 'active') throw new Error(`"${parent.name}" is not an active reason for work`);
  if (!WORK_PARENTS.includes(parent.kind)) {
    throw new Error('a work item names the decision, requirement, initiative, or metric it serves');
  }
  const relation = parent.kind === 'metric' ? 'contributes_to' : 'implements';
  const work = addEntity(store, { id: input.id, kind: 'work_item', name: input.name, at: input.at });
  addRelation(store, {
    id: input.relationId,
    kind: relation,
    fromId: work.id,
    toId: parent.id,
    basis: 'declared',
    confidence: 1,
    confirmed: true,
    at: input.at,
  });
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
