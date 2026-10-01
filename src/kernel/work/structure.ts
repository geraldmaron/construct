/**
 * kernel/work/structure.ts — where a work item sits and why it exists.
 *
 * A work item is admitted to the backlog (status open) when it has a reason
 * to exist: an admitted parent work item, an active decision, requirement,
 * initiative, or metric it serves, or the person filing it from a terminal of
 * their own. An outcome is no exception: a session's outcome needs a reason
 * too. Work filed without one is proposed: visible in the ledger, never
 * ready, never claimable. Linking a reason later admits it, so does the
 * person admitting it, and admitting an item admits its proposed children.
 * A reason is a recorded link, not the person's approval: a decision a
 * session remembered on the person's behalf, labeled relayed, is one.
 *
 * Dependencies are `blocks` (the item is not ready until the other one is
 * finished) and `informs` (context only). Parents form a tree; neither a
 * parent chain nor a chain of blocks may cycle.
 */

import type { StateStore } from '../state/open.ts';
import type { Entity } from '../state/graph.ts';
import { linkWorkToReason, resolveWorkReason, workReasons } from '../state/admission.ts';
import { requireInstant } from '../state/rows.ts';
import {
  acceptanceOf,
  addWorkDependency,
  childrenOf,
  createWork,
  getWork,
  listWorkDependencies,
  recordEvent,
  removeWorkDependency,
  type WorkItem,
  type WorkKind,
} from './service.ts';

const FINISHED = new Set(['completed', 'cancelled', 'superseded', 'historical']);

/** Why a work item is in the backlog, or null when nothing yet gives it a reason. */
export type AdmissionBasis = 'parent' | 'serves' | 'person';

export interface StructureLinks {
  /** A work item this one is part of. */
  readonly parentId?: string;
  /** A decision, requirement, initiative, or metric (entity id or governing statement id) this item serves. */
  readonly serves?: string;
  /** Work that must be finished before this one is ready. */
  readonly blockedBy?: readonly string[];
  /** Work that gives this one context without blocking it. */
  readonly related?: readonly string[];
}

export interface FileWorkInput extends StructureLinks {
  readonly id: string;
  readonly kind: WorkKind;
  readonly title: string;
  readonly description?: string;
  /** What a finished item meets, one statement each. */
  readonly acceptance?: readonly string[];
  readonly risk?: string;
  /** Source ids whose refresh should send this item back for requalification. */
  readonly sources?: readonly string[];
  /** The person filed it from a terminal of their own; that alone admits it. */
  readonly byPerson: boolean;
  readonly at: string;
  readonly actor?: string;
  readonly nextId: (prefix: string) => string;
}

export interface Filed {
  readonly work: WorkItem;
  readonly admitted: boolean;
  readonly admittedBy: AdmissionBasis | null;
  /** For proposed work: how to admit it. */
  readonly next: string | null;
}

const ADMIT_HINT =
  'Proposed work is never ready or claimable. Give it a reason: link a parent work item or the decision, requirement, initiative, or metric it serves, or have the person run `construct work admit <id>`.';

function requireWork(store: StateStore, id: string, role: string): WorkItem {
  const w = getWork(store, id);
  if (!w) throw new Error(`no ${role} work ${id}`);
  return w;
}

function requireParent(store: StateStore, childId: string | null, parentId: string): WorkItem {
  const parent = requireWork(store, parentId, 'parent');
  if (FINISHED.has(parent.status)) throw new Error(`parent ${parentId} is ${parent.status}; finished work is not a reason for new work`);
  if (childId !== null) {
    for (let at: WorkItem | null = parent; at !== null; at = at.parentId ? getWork(store, at.parentId) : null) {
      if (at.id === childId) throw new Error(`making ${parentId} the parent of ${childId} would put ${childId} inside itself`);
    }
  }
  return parent;
}

function cleanList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))];
}

/** Why `work` is admitted, judged from what it carries now. The person's own admission is recorded, not recomputed. */
export function admissionBasis(store: StateStore, work: WorkItem): AdmissionBasis | null {
  if (work.parentId) {
    const parent = getWork(store, work.parentId);
    if (parent && parent.status !== 'proposed' && !FINISHED.has(parent.status)) return 'parent';
  }
  if (work.entityId && workReasons(store, work.entityId).length > 0) return 'serves';
  return null;
}

function addDeps(store: StateStore, from: string, ids: readonly string[], kind: 'blocks' | 'informs', at: string, nextId: (p: string) => string): void {
  for (const to of ids) {
    requireWork(store, to, kind === 'blocks' ? 'blocking' : 'related');
    if (listWorkDependencies(store, from).some((d) => d.fromId === from && d.toId === to && d.kind === kind)) continue;
    addWorkDependency(store, { id: nextId('dep'), fromId: from, toId: to, kind, at });
  }
}

function linkReason(store: StateStore, work: WorkItem, serves: string, at: string, nextId: (p: string) => string): Entity {
  const reason = resolveWorkReason(store, serves);
  if (!work.entityId) throw new Error(`work ${work.id} has no graph entity to link`);
  linkWorkToReason(store, { workEntityId: work.entityId, reason, relationId: nextId('rel'), at });
  return reason;
}

/** Admit `work`, then every proposed child it now gives a reason to. */
function promote(store: StateStore, work: WorkItem, basis: AdmissionBasis, at: string, actor: string | null): void {
  store.db
    .prepare(`UPDATE work_items SET status = 'open', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'proposed'`)
    .run(at, work.id);
  recordEvent(store, work.id, at, 'admitted', actor, work.revision + 1, { basis });
  for (const child of childrenOf(store, work.id)) {
    if (child.status === 'proposed') promote(store, child, 'parent', at, actor);
  }
}

/**
 * File a work item with its place in the ledger: parent, reason, dependencies,
 * acceptance criteria, risk, and premise sources. It is open when something
 * admits it and proposed otherwise.
 */
export function fileWork(store: StateStore, input: FileWorkInput): Filed {
  requireInstant(input.at, 'work.at');
  return store.transaction(() => {
    const parent = input.parentId ? requireParent(store, null, input.parentId) : null;
    const reason = input.serves ? resolveWorkReason(store, input.serves) : null;
    const basis: AdmissionBasis | null =
      parent && parent.status !== 'proposed' ? 'parent' : reason ? 'serves' : input.byPerson ? 'person' : null;
    const acceptance = cleanList(input.acceptance);
    const sources = cleanList(input.sources);
    const created = createWork(store, {
      id: input.id,
      kind: input.kind,
      title: input.title,
      description: input.description?.trim() ? input.description : input.title,
      parentId: input.parentId,
      acceptance: acceptance.length > 0 ? acceptance : undefined,
      risk: input.risk?.trim() ? input.risk.trim() : undefined,
      premises: sources.length > 0 ? { sources } : undefined,
      status: basis ? 'open' : 'proposed',
      at: input.at,
      actor: input.actor,
    });
    if (reason) linkWorkToReason(store, { workEntityId: created.entityId!, reason, relationId: input.nextId('rel'), at: input.at });
    addDeps(store, created.id, cleanList(input.blockedBy), 'blocks', input.at, input.nextId);
    addDeps(store, created.id, cleanList(input.related), 'informs', input.at, input.nextId);
    if (basis) recordEvent(store, created.id, input.at, 'admitted', input.actor ?? null, created.revision, { basis });
    return { work: getWork(store, created.id)!, admitted: basis !== null, admittedBy: basis, next: basis ? null : ADMIT_HINT };
  });
}

export interface LinkInput extends StructureLinks {
  readonly id: string;
  readonly at: string;
  readonly actor?: string;
  readonly nextId: (prefix: string) => string;
}

/** Add structure to an existing item. A proposed item that gains a reason is admitted. */
export function linkWork(store: StateStore, input: LinkInput): WorkItem {
  requireInstant(input.at, 'work.at');
  return store.transaction(() => {
    const current = requireWork(store, input.id, 'such');
    if (FINISHED.has(current.status)) throw new Error(`work ${input.id} is ${current.status}; reopen it before changing its structure`);
    const changed: Record<string, unknown> = {};
    if (input.parentId) {
      requireParent(store, current.id, input.parentId);
      store.db.prepare('UPDATE work_items SET parent_id = ? WHERE id = ?').run(input.parentId, current.id);
      changed.parent = input.parentId;
    }
    if (input.serves) changed.serves = linkReason(store, current, input.serves, input.at, input.nextId).id;
    const blockedBy = cleanList(input.blockedBy);
    const related = cleanList(input.related);
    addDeps(store, current.id, blockedBy, 'blocks', input.at, input.nextId);
    addDeps(store, current.id, related, 'informs', input.at, input.nextId);
    if (blockedBy.length) changed.blockedBy = blockedBy;
    if (related.length) changed.related = related;
    if (Object.keys(changed).length === 0) throw new Error('nothing to link: name a parent, a reason it serves, or work it is blocked by or related to');
    store.db.prepare('UPDATE work_items SET revision = revision + 1, updated_at = ? WHERE id = ?').run(input.at, current.id);
    recordEvent(store, current.id, input.at, 'linked', input.actor ?? null, current.revision + 1, changed);
    const now = getWork(store, current.id)!;
    if (now.status === 'proposed') {
      const basis = admissionBasis(store, now);
      if (basis) promote(store, now, basis, input.at, input.actor ?? null);
    }
    return getWork(store, current.id)!;
  });
}

export interface UnlinkInput {
  readonly id: string;
  readonly parent?: boolean;
  readonly blockedBy?: readonly string[];
  readonly related?: readonly string[];
  readonly at: string;
  readonly actor?: string;
}

/** Remove a parent or dependencies. An admitted item stays admitted; admission is not taken back by editing. */
export function unlinkWork(store: StateStore, input: UnlinkInput): WorkItem {
  requireInstant(input.at, 'work.at');
  return store.transaction(() => {
    const current = requireWork(store, input.id, 'such');
    const removed: Record<string, unknown> = {};
    if (input.parent && current.parentId) {
      store.db.prepare('UPDATE work_items SET parent_id = NULL WHERE id = ?').run(current.id);
      removed.parent = current.parentId;
    }
    const gone = (ids: readonly string[] | undefined, kind: 'blocks' | 'informs'): string[] =>
      cleanList(ids).filter((to) => removeWorkDependency(store, { fromId: current.id, toId: to, kind }));
    const blockedBy = gone(input.blockedBy, 'blocks');
    const related = gone(input.related, 'informs');
    if (blockedBy.length) removed.blockedBy = blockedBy;
    if (related.length) removed.related = related;
    if (Object.keys(removed).length === 0) throw new Error(`nothing to unlink from ${current.id}`);
    store.db.prepare('UPDATE work_items SET revision = revision + 1, updated_at = ? WHERE id = ?').run(input.at, current.id);
    recordEvent(store, current.id, input.at, 'unlinked', input.actor ?? null, current.revision + 1, removed);
    return getWork(store, current.id)!;
  });
}

/**
 * Move proposed work into the backlog. The person may admit anything; any
 * other caller only work that already carries a reason.
 */
export function admitProposedWork(store: StateStore, input: { readonly id: string; readonly byPerson: boolean; readonly at: string; readonly actor?: string }): WorkItem {
  requireInstant(input.at, 'work.at');
  return store.transaction(() => {
    const current = requireWork(store, input.id, 'such');
    if (current.status !== 'proposed') throw new Error(`work ${input.id} is ${current.status}, not proposed`);
    const basis = admissionBasis(store, current) ?? (input.byPerson ? 'person' : null);
    if (!basis) throw new Error(`work ${input.id} has no reason to exist yet. ${ADMIT_HINT}`);
    promote(store, current, basis, input.at, input.actor ?? null);
    return getWork(store, current.id)!;
  });
}

export interface WorkStructure {
  readonly parent: Pick<WorkItem, 'id' | 'title' | 'status'> | null;
  readonly children: readonly Pick<WorkItem, 'id' | 'title' | 'status' | 'kind'>[];
  readonly serves: readonly Pick<Entity, 'id' | 'kind' | 'name'>[];
  readonly blockedBy: readonly Pick<WorkItem, 'id' | 'title' | 'status'>[];
  readonly blocking: readonly Pick<WorkItem, 'id' | 'title' | 'status'>[];
  readonly related: readonly Pick<WorkItem, 'id' | 'title' | 'status'>[];
  readonly acceptance: readonly string[];
  readonly risk: string | null;
  readonly sources: readonly string[];
  readonly admittedBy: AdmissionBasis | null;
}

const brief = (w: WorkItem) => ({ id: w.id, title: w.title, status: w.status });

/** The basis recorded when the item was admitted, when it was admitted through this module. */
function recordedBasis(store: StateStore, id: string): AdmissionBasis | null {
  const row = store.db
    .prepare(`SELECT payload_json FROM work_events WHERE work_id = ? AND kind = 'admitted' ORDER BY id DESC LIMIT 1`)
    .get(id) as { payload_json: string } | undefined;
  if (!row) return null;
  const basis = (JSON.parse(row.payload_json) as { basis?: unknown }).basis;
  return basis === 'parent' || basis === 'serves' || basis === 'person' ? basis : null;
}

/** Everything around one work item, for show. */
export function workStructure(store: StateStore, work: WorkItem): WorkStructure {
  const deps = listWorkDependencies(store, work.id);
  const items = (ids: readonly string[]) => ids.map((id) => getWork(store, id)).filter((w): w is WorkItem => w !== null).map(brief);
  const premises = work.premises as { sources?: unknown } | null;
  const parent = work.parentId ? getWork(store, work.parentId) : null;
  return {
    parent: parent ? brief(parent) : null,
    children: childrenOf(store, work.id).map((c) => ({ ...brief(c), kind: c.kind })),
    serves: work.entityId ? workReasons(store, work.entityId).map((e) => ({ id: e.id, kind: e.kind, name: e.name })) : [],
    blockedBy: items(deps.filter((d) => d.kind === 'blocks' && d.fromId === work.id).map((d) => d.toId)),
    blocking: items(deps.filter((d) => d.kind === 'blocks' && d.toId === work.id).map((d) => d.fromId)),
    related: items(deps.filter((d) => d.kind === 'informs').map((d) => (d.fromId === work.id ? d.toId : d.fromId))),
    acceptance: acceptanceOf(work),
    risk: typeof work.risk === 'string' ? work.risk : work.risk === null || work.risk === undefined ? null : JSON.stringify(work.risk),
    sources: Array.isArray(premises?.sources) ? premises.sources.filter((s): s is string => typeof s === 'string') : [],
    admittedBy: work.status === 'proposed' ? null : recordedBasis(store, work.id) ?? admissionBasis(store, work),
  };
}

