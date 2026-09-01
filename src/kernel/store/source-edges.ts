/**
 * kernel/store/source-edges.ts — how two declared sources stand to each other.
 *
 * A declaration (kernel/store/sources.ts) says what one source is. Nothing said
 * what a pair of them are, so a strategy that governs a repository and a plan
 * that supersedes an older one reached a dispatch as two unrelated piles, and
 * two sources that were supposed to agree could drift apart with nothing on the
 * record saying they were ever joined.
 *
 * The vocabulary is fixed and small, and every word in it is one a person
 * already uses about their own material: `governs`, `depends-on`, `feeds`,
 * `supersedes`, `covers-same-initiative`, `contradicts`. It is deliberately not
 * extensible. A relationship nothing reads is an assertion wearing the costume
 * of a feature, so each of the six names below is consumed by something that
 * behaves differently because of it — how ground is partitioned across
 * dispatches, and what a watch over both ends raises when one moves.
 *
 * What this module deliberately is NOT: a knowledge graph, a store of inferred
 * links, or anything that walks a source's contents. There is no traversal
 * engine and no second runtime here — a handful of rows, read by name. Every
 * row is either a relationship a person typed or one a model proposed and a
 * person decided; nothing writes one from a guess.
 *
 * Relationships retire, exactly as sources do, under the same two database
 * triggers: a run assembled from a relationship carries that relationship in
 * its record, and one that could be edited afterwards would let the record
 * agree with whatever is believed now.
 */

import { getProposal, getSource, markApplied, proposeWrite } from './sources.ts';
import type { WriteProposal } from './sources.ts';
import { transact } from './open.ts';
import type { Store } from './open.ts';

/**
 * The six things one source can be to another, and nothing else.
 *
 *   governs                 the first sets the rule the second is held to.
 *   depends-on              the first cannot be read correctly without the second.
 *   feeds                   the first supplies material the second is built from.
 *   supersedes              the first replaces the second; the second is past.
 *   covers-same-initiative  both describe one initiative from different places.
 *   contradicts             the two say incompatible things and both are live.
 */
export const SOURCE_RELATIONS = [
  'governs',
  'depends-on',
  'feeds',
  'supersedes',
  'covers-same-initiative',
  'contradicts',
] as const;

export type SourceRelation = (typeof SOURCE_RELATIONS)[number];

/** One declared relationship, from one source to another. Direction is meaningful. */
export interface SourceEdge {
  readonly id: string;
  readonly workspace: string;
  readonly from: string;
  readonly to: string;
  readonly relation: SourceRelation;
  /** Why the user says these two stand this way. Their line, possibly empty. */
  readonly note: string;
  readonly declaredAt: string;
  readonly retiredAt: string | null;
}

/**
 * How a relationship reads out loud, from each end. Written once here because
 * a relationship printed one way in a listing and another way in a watch
 * finding is the second copy every surface in this system exists to avoid.
 */
const PHRASES: Readonly<Record<SourceRelation, { readonly forward: string; readonly backward: string }>> = {
  governs: { forward: 'governs', backward: 'is governed by' },
  'depends-on': { forward: 'depends on', backward: 'is depended on by' },
  feeds: { forward: 'feeds', backward: 'is fed by' },
  supersedes: { forward: 'supersedes', backward: 'is superseded by' },
  'covers-same-initiative': {
    forward: 'covers the same initiative as',
    backward: 'covers the same initiative as',
  },
  contradicts: { forward: 'contradicts', backward: 'contradicts' },
};

/** The relationship in words, read from `from` towards `to`. */
export function relationPhrase(relation: SourceRelation): string {
  return PHRASES[relation].forward;
}

/** The relationship in words, read from `to` back towards `from`. */
export function reverseRelationPhrase(relation: SourceRelation): string {
  return PHRASES[relation].backward;
}

/**
 * What an active relationship does to ground assembly, in one sentence a
 * person can read beside the edge itself. Partition (kernel/run/partition.ts)
 * is the behavior; this is the same rules said out loud so a declare is not
 * silent about withholding.
 */
export function groundAssemblyEffect(relation: SourceRelation): string {
  switch (relation) {
    case 'governs':
    case 'depends-on':
    case 'feeds':
    case 'contradicts':
      return 'Both ends travel together into every dispatch that carries either.';
    case 'covers-same-initiative':
      return 'The two ends are spread across dispatches rather than both handed to every one.';
    case 'supersedes':
      return (
        'The replacement and the replaced are spread across dispatches; ' +
        'the replaced source is withheld from any dispatch that carries its replacement.'
      );
  }
}

interface Row {
  readonly id: string;
  readonly workspace: string;
  readonly from_source: string;
  readonly to_source: string;
  readonly relation: string;
  readonly note: string;
  readonly declared_at: string;
  readonly retired_at: string | null;
}

function toEdge(row: Row): SourceEdge {
  return {
    id: row.id,
    workspace: row.workspace,
    from: row.from_source,
    to: row.to_source,
    relation: row.relation as SourceRelation,
    note: row.note,
    declaredAt: row.declared_at,
    retiredAt: row.retired_at,
  };
}

/**
 * The refusals every path into this table passes through, whether a person
 * typed the relationship or a decision adopted one a model proposed. Written
 * once so the two paths cannot disagree about what a well-formed relationship
 * is: an unknown word, a source that does not exist or was retired, and a
 * source pointed at itself are all things nothing downstream could act on.
 */
function relationProblem(
  store: Store,
  edge: { readonly from: string; readonly to: string; readonly relation: string },
): string | null {
  if (!(SOURCE_RELATIONS as readonly string[]).includes(edge.relation)) {
    return `unknown relationship "${edge.relation}" (words: ${SOURCE_RELATIONS.join(', ')})`;
  }
  if (edge.from === edge.to) {
    return `a source does not stand in a relationship to itself (${edge.from})`;
  }
  for (const id of [edge.from, edge.to]) {
    const source = getSource(store, id);
    if (!source) return `no source ${id} — declare it first with source add`;
    if (source.retiredAt) {
      return `source ${id} was retired at ${source.retiredAt}; a retired source joins nothing`;
    }
  }
  return null;
}

/**
 * Declare a relationship between two already-declared sources.
 *
 * Direction is the user's statement and is kept as typed: `A governs B` and
 * `B governs A` are different claims, and quietly normalizing one into the
 * other would be this module deciding which of them the user meant.
 */
export function declareSourceEdge(store: Store, edge: Omit<SourceEdge, 'retiredAt'>): void {
  if (edge.workspace.trim() === '') {
    throw new Error(`declareSourceEdge: ${edge.id} names no workspace`);
  }
  const problem = relationProblem(store, edge);
  if (problem) throw new Error(`declareSourceEdge: ${problem}`);
  store.db
    .prepare(
      `INSERT INTO source_edges (id, workspace, from_source, to_source, relation, note, declared_at, retired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(edge.id, edge.workspace, edge.from, edge.to, edge.relation, edge.note.trim(), edge.declaredAt);
}

export function getSourceEdge(store: Store, id: string): SourceEdge | null {
  const row = store.db.prepare('SELECT * FROM source_edges WHERE id = ?').get(id) as Row | undefined;
  return row ? toEdge(row) : null;
}

/** Every relationship declared in one workspace, active only unless asked otherwise, oldest first. */
export function sourceEdgesFor(
  store: Store,
  workspace: string,
  opts?: { includeRetired?: boolean },
): SourceEdge[] {
  const rows = (
    opts?.includeRetired
      ? store.db
          .prepare('SELECT * FROM source_edges WHERE workspace = ? ORDER BY declared_at, id')
          .all(workspace)
      : store.db
          .prepare(
            'SELECT * FROM source_edges WHERE workspace = ? AND retired_at IS NULL ORDER BY declared_at, id',
          )
          .all(workspace)
  ) as unknown as Row[];
  return rows.map(toEdge);
}

/**
 * The active relationships with a given source at either end. Direction is
 * preserved on the rows that come back, so a caller can still tell which end
 * it asked about.
 */
export function sourceEdgesTouching(store: Store, source: string): SourceEdge[] {
  const rows = store.db
    .prepare(
      `SELECT * FROM source_edges
       WHERE retired_at IS NULL AND (from_source = ? OR to_source = ?)
       ORDER BY declared_at, id`,
    )
    .all(source, source) as unknown as Row[];
  return rows.map(toEdge);
}

/**
 * The active relationships with both ends inside a given set of sources.
 *
 * Ground assembly asks this rather than for a whole workspace's relationships:
 * a relationship to a source this run never read describes nothing the run is
 * holding, and letting it reach the partition would move material on the
 * strength of ground nobody looked at.
 */
export function sourceEdgesAmong(store: Store, sources: readonly string[]): SourceEdge[] {
  const within = new Set(sources);
  if (within.size === 0) return [];
  const rows = store.db
    .prepare('SELECT * FROM source_edges WHERE retired_at IS NULL ORDER BY declared_at, id')
    .all() as unknown as Row[];
  return rows.map(toEdge).filter((edge) => within.has(edge.from) && within.has(edge.to));
}

/**
 * Retire a relationship: it stops governing anything and stays inspectable,
 * because runs assembled under it point at it. Retiring twice is an error
 * rather than a no-op — the second caller believed something false about what
 * was still standing.
 */
export function retireSourceEdge(store: Store, id: string, retiredAt: string): void {
  const existing = getSourceEdge(store, id);
  if (!existing) throw new Error(`retireSourceEdge: no relationship ${id}`);
  if (existing.retiredAt) {
    throw new Error(`retireSourceEdge: ${id} was already retired at ${existing.retiredAt}`);
  }
  store.db.prepare('UPDATE source_edges SET retired_at = ? WHERE id = ?').run(retiredAt, id);
}

/** The parts of a proposed relationship, keyed to the proposal that carries its fate. */
export interface ProposedSourceEdge {
  readonly proposal: string;
  readonly from: string;
  readonly to: string;
  readonly relation: SourceRelation;
  readonly note: string;
  readonly recordedAt: string;
}

/**
 * File a relationship a model noticed, as a proposal and nothing more.
 *
 * A model reading two sources can see that one supersedes the other long
 * before anyone types it, and that observation is worth having. What it is not
 * worth is acting on: a relationship silently adopted changes what every later
 * dispatch reads, and the user would have no way to see that it was Construct's
 * guess rather than their own statement. So this writes the proposal row and
 * the relationship's parts together, in one transaction, and writes nothing
 * into `source_edges` at all.
 *
 * The proposal is filed at high risk, which is the store's word for "standing
 * consent does not reach this". It is the right word here: standing consent is
 * a workspace's blanket yes to small outward changes, and reshaping the ground
 * every future run is assembled from is not one.
 */
export function proposeSourceEdge(
  store: Store,
  proposal: Omit<WriteProposal, 'risk'>,
  edge: Omit<ProposedSourceEdge, 'proposal'>,
): void {
  const problem = relationProblem(store, edge);
  if (problem) throw new Error(`proposeSourceEdge: ${problem}`);
  transact(store, () => {
    proposeWrite(store, { ...proposal, risk: 'high' });
    store.db
      .prepare(
        `INSERT INTO proposed_source_edges (proposal, from_source, to_source, relation, note, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(proposal.id, edge.from, edge.to, edge.relation, edge.note.trim(), edge.recordedAt);
  });
}

/** The relationship a proposal proposes, or null when the proposal is not one. */
export function proposedSourceEdge(store: Store, proposal: string): ProposedSourceEdge | null {
  const row = store.db
    .prepare(
      `SELECT proposal, from_source, to_source, relation, note, recorded_at
       FROM proposed_source_edges WHERE proposal = ?`,
    )
    .get(proposal) as
    | {
        proposal: string;
        from_source: string;
        to_source: string;
        relation: string;
        note: string;
        recorded_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    proposal: row.proposal,
    from: row.from_source,
    to: row.to_source,
    relation: row.relation as SourceRelation,
    note: row.note,
    recordedAt: row.recorded_at,
  };
}

/**
 * The id a proposed relationship becomes when it is adopted, derived from the
 * proposal so the relationship and the decision that created it can always be
 * read off each other.
 */
export function adoptedEdgeId(proposal: string): string {
  return `rel-${proposal}`;
}

/**
 * Adopt a proposed relationship, if and only if a decision authorizes it.
 *
 * The authority check is not repeated here: `markApplied` already holds the
 * only two answers the store accepts, and it throws when neither is present.
 * Running it first, inside the transaction, is what makes "no decision, no
 * relationship" a property of the database rather than of this function
 * remembering to ask — a throw rolls back the declaration with it.
 *
 * Nothing crosses to anyone else's system here, which is why this is the one
 * proposal a host is not asked to carry out: the change lands in the user's own
 * store, and a host that could not be reached would be an obstacle invented on
 * the way to a local write.
 */
export function adoptProposedEdge(
  store: Store,
  proposal: string,
  reason: string,
  at: string,
): SourceEdge {
  const proposed = proposedSourceEdge(store, proposal);
  if (!proposed) throw new Error(`adoptProposedEdge: ${proposal} proposes no relationship`);
  const record = getProposal(store, proposal);
  if (!record) throw new Error(`adoptProposedEdge: no proposal ${proposal}`);
  const edge: Omit<SourceEdge, 'retiredAt'> = {
    id: adoptedEdgeId(proposal),
    workspace: record.workspace,
    from: proposed.from,
    to: proposed.to,
    relation: proposed.relation,
    note: proposed.note,
    declaredAt: at,
  };
  transact(store, () => {
    markApplied(store, proposal, reason, at);
    declareSourceEdge(store, edge);
  });
  return { ...edge, retiredAt: null };
}
