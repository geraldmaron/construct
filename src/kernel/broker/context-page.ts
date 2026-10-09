/** Bounded pages over full project history, with explicit revision and continuation. */
import { createHash } from 'node:crypto';
import type { StateStore } from '../state/open.ts';
import { getDecision } from '../state/decisions.ts';
import { getRun } from '../state/runs.ts';
import { getEntity } from '../state/graph.ts';
import { getWork } from '../work/service.ts';
import { asPeerData } from '../work/handoff.ts';
import { ToolInputError } from './definition.ts';

type Cursor = { v: 1; topic: string; query: string; offset: number; revision: string; through?: number };
function decode(value: string | undefined, topic: string, query: string): Cursor | null {
  if (!value) return null;
  if (value.length > 2048) throw new ToolInputError('context cursor is too long; restart this query', { field: 'cursor' });
  let c: Cursor;
  try { c = JSON.parse(Buffer.from(value, 'base64url').toString()); } catch { throw new ToolInputError('invalid context cursor; restart this query', { field: 'cursor' }); }
  if (!c || c.v !== 1 || c.topic !== topic || c.query !== query || !Number.isSafeInteger(c.offset) || c.offset < 0 || !/^[a-f0-9]{64}$/.test(c.revision) || (c.through !== undefined && (!Number.isSafeInteger(c.through) || c.through < 0))) throw new ToolInputError('context cursor belongs to a different query or is invalid; restart this query', { field: 'cursor' });
  return c;
}
function result<T>(items: T[], total: number, topic: string, query: string, offset: number, revision: string, through?: number) {
  const remaining = Math.max(0, total - offset - items.length);
  const next: Cursor = { v: 1, topic, query, offset: offset + items.length, revision, ...(through !== undefined ? { through } : {}) };
  return { items, total, truncated: remaining > 0, query: query || null, nextCursor: remaining ? Buffer.from(JSON.stringify(next)).toString('base64url') : null,
    contextVersion: 1, revision, offset, remaining, selection: { topic, reason: query ? `literal match for ${JSON.stringify(query)}` : 'topic history', omittedFromPage: total - items.length },
    completeness: remaining ? 'more_available' : 'complete_for_query' };
}
function checkRevision(cursor: Cursor | null, revision: string) {
  if (cursor && cursor.revision !== revision) throw new ToolInputError('context changed since this page; restart the query to avoid mixing revisions', { field: 'cursor' });
}

/** Collections without storage caps still get a revision-bound continuation. */
export function contextPage<T>(items: readonly T[], text: (item: T) => string, topic: string, query: string | undefined, limit: number, value?: string) {
  const q = query?.trim().toLowerCase() ?? '';
  const cursor = decode(value, topic, q);
  const matched = q ? items.filter((item) => text(item).toLowerCase().includes(q)) : [...items];
  const revision = createHash('sha256').update(JSON.stringify(matched)).digest('hex');
  checkRevision(cursor, revision);
  const offset = cursor?.offset ?? 0;
  return result(matched.slice(offset, offset + limit), matched.length, topic, q, offset, revision);
}

const TABLES = {
  decisions: { table: 'decisions', text: "id || ' ' || question || ' ' || kind || ' ' || state || ' ' || coalesce(resolution_json,'')" },
  source_history: { table: 'observations', text: "coalesce(source_id,'') || ' ' || kind || ' ' || summary || ' ' || coalesce(evidence_json,'')" },
  activity: { table: 'activity_events', text: "kind || ' ' || coalesce(session_id,'') || ' ' || coalesce(agent,'') || ' ' || coalesce(actor,'') || ' ' || payload_json" },
  runs: { table: 'workflow_runs', text: "id || ' ' || workflow_id || ' ' || state || ' ' || input_json" },
  entities: { table: 'entities', text: "id || ' ' || kind || ' ' || name" },
  work: { table: 'work_items', text: "id || ' ' || title || ' ' || coalesce(description,'') || ' ' || status || ' ' || kind" },
} as const;
export type HistoryTopic = keyof typeof TABLES;
export function isHistoryTopic(topic: string): topic is HistoryTopic { return Object.hasOwn(TABLES, topic); }

/** SQL filters before paging. Iteration hashes the snapshot without retaining its unbounded rows. */
export function historyPage(store: StateStore, topic: HistoryTopic, query: string | undefined, limit: number, value?: string) {
  const q = query?.trim().toLowerCase() ?? '';
  const cursor = decode(value, topic, q);
  const { table, text } = TABLES[topic]; // Static identifiers only, never caller/source text.
  const through = cursor?.through ?? Number((store.db.prepare(`SELECT coalesce(max(rowid),0) AS n FROM ${table}`).get() as { n: number }).n);
  const offset = cursor?.offset ?? 0;
  const hash = createHash('sha256');
  let total = 0;
  const selected: Record<string, unknown>[] = [];
  for (const row of store.db.prepare(`SELECT rowid AS context_rowid, * FROM ${table} WHERE rowid <= ? ${topic === 'source_history' ? 'AND source_id IS NOT NULL' : ''} AND (? = '' OR instr(lower(${text}), ?) > 0) ORDER BY rowid DESC`).iterate(through, q, q)) {
    hash.update(JSON.stringify(row));
    if (total >= offset && selected.length < limit) selected.push(row);
    total++;
  }
  const revision = hash.digest('hex');
  checkRevision(cursor, revision);
  const items = selected.map((row) => {
    if (topic === 'decisions') return getDecision(store, String(row.id))!;
    if (topic === 'source_history') return { id: row.id, sourceId: row.source_id, kind: row.kind, summary: row.summary, observedAt: row.observed_at, evidence: asPeerData('recorded source observation', JSON.parse(String(row.evidence_json ?? 'null'))) };
    if (topic === 'runs') return getRun(store, String(row.id))!;
    if (topic === 'entities') return getEntity(store, String(row.id))!;
    if (topic === 'work') return getWork(store, String(row.id))!;
    return { id: row.id, at: row.at, kind: row.kind, sessionId: row.session_id, agent: row.agent, channel: row.channel, actor: row.actor,
      payload: asPeerData(String(row.actor ?? row.session_id ?? 'unknown'), row.kind === 'semantic.prepared' ? (() => { const p = JSON.parse(String(row.payload_json)); return { digest: p.digest, preparedRef: `review:${String(row.id)}`, artifactRefs: p.bundle?.artifacts?.map((a: { ref: string }) => a.ref), evidenceRefs: p.bundle?.evidence?.map((e: { ref: string }) => e.ref), problems: p.bundle?.problems, heldContent: 'Available only to the explicitly invoked reviewer; source text is not replayed in activity context.' }; })() : JSON.parse(String(row.payload_json))) };
  });
  return result(items, total, topic, q, offset, revision, through);
}
