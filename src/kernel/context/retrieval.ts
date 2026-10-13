/** Rebuildable project-local retrieval. Ranking is relevance, never authority. */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { StateStore } from '../state/open.ts';
import { listSources, freshnessOf, authorityOf } from '../state/sources.ts';
import { currentManifestRecord, snapshotItemRef } from '../source/manifest.ts';
import { asPeerData } from '../work/handoff.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const CHUNK = 2400;
const DOCUMENT_CAP = 20_000;
const STOP_WORDS = new Set('a an the and or of to for in on with is are was were be do does did can we our it what who why where how'.split(' '));
export interface ContextDocument {
  ref: string; embeddingRef: string; offset: number; topic: string; text: string; digest: string; revision: string;
  provenance: 'reported' | 'witnessed'; status: string; sourceId?: string;
  freshness?: string; authority?: unknown; truncated?: boolean;
  entityId?: string; links?: readonly string[];
}
interface Corpus { documents: ContextDocument[]; gaps: string[]; revision: string }
const RECORDS = [
  { table: 'statements', topic: 'statements', prefix: 'statement', text: ['kind', 'text'], state: 'status' },
  { table: 'decisions', topic: 'decisions', prefix: 'decision', text: ['question', 'resolution_json'], state: 'state' },
  { table: 'claims', topic: 'claims', prefix: 'claim', text: ['claim_type', 'statement'], state: 'status' },
  { table: 'entities', topic: 'entities', prefix: 'entity', text: ['kind', 'name'], state: 'status' },
  { table: 'work_items', topic: 'work', prefix: 'work', text: ['title', 'description', 'acceptance_json'], state: 'status' },
  { table: 'workflow_runs', topic: 'runs', prefix: 'run', text: ['workflow_id', 'input_json'], state: 'state' },
  { table: 'deliverables', topic: 'outcomes', prefix: 'deliverable', text: ['kind', 'body_json'], state: 'trust_state' },
] as const;
function corpus(store: StateStore, at: string): Corpus {
  const documents: ContextDocument[] = [], gaps: string[] = [];
  function add(doc: Omit<ContextDocument, 'digest' | 'embeddingRef' | 'offset'>) {
    for (let start = 0; start < doc.text.length; start += CHUNK - 200) {
      if (documents.length >= DOCUMENT_CAP) { gaps.push('Context chunk cap reached; older records may be omitted. Inspect project_context for full history.'); return; }
      const text = doc.text.slice(start, start + CHUNK);
      documents.push({ ...doc, text, embeddingRef: `context:${digest(`${doc.ref}:${start}`)}`, offset: start, digest: digest(text) });
    }
  }
  for (const spec of RECORDS) {
    for (const row of store.db.prepare(`SELECT * FROM ${spec.table} ORDER BY rowid DESC`).iterate() as Iterable<Record<string, unknown>>) {
      const text = spec.text.map(k => String(row[k] ?? '')).join('\n');
      const links = [row.parent_id, row.entity_id, row.subject_id, row.run_id].filter((x): x is string => typeof x === 'string');
      add({ ref: `${spec.prefix}:${String(row.id)}`, topic: spec.topic, text,
        revision: String(row.revision ?? row.updated_at ?? row.created_at ?? row.id),
        provenance: 'witnessed', status: String(row[spec.state] ?? 'recorded'),
        ...(typeof (row.entity_id ?? row.subject_id) === 'string' ? { entityId: String(row.entity_id ?? row.subject_id) } : {}), links });
    }
  }
  for (const s of listSources(store, { status: 'active' })) {
    if (!s.canRead) { gaps.push(`${s.id}: read access unavailable`); continue; }
    if (s.reachability === 'unreachable') gaps.push(`${s.id}: current access is unreachable; only previously admitted text is available`);
    const snapshot = s.lastSnapshotId ? store.db.prepare('SELECT coverage_json FROM source_snapshots WHERE id=?').get(s.lastSnapshotId) as {coverage_json:string|null} | undefined : undefined;
    if (snapshot?.coverage_json && JSON.parse(snapshot.coverage_json).complete === false) gaps.push(`${s.id}: captured coverage is partial; inspect source status for unread areas`);
    const manifest = currentManifestRecord(store, s.id);
    if (!manifest || !s.lastSnapshotId) { gaps.push(`${s.id}: no admitted text`); continue; }
    for (const e of manifest.entries) {
      if (typeof e.text !== 'string') { gaps.push(`${s.id}:${e.ref}: text unavailable`); continue; }
      if (e.truncated) gaps.push(`${s.id}:${e.ref}: captured text is truncated`);
      add({ ref: snapshotItemRef(s.lastSnapshotId, e.ref), topic: 'sources', text: `${e.ref}\n${e.text}`,
        revision: s.lastSnapshotId, provenance: manifest.provenance, status: e.supersededBy ? 'superseded' : 'captured',
        sourceId: s.id, freshness: freshnessOf(store, s.id, at), authority: {level:s.authorityLevel,claimTypes:authorityOf(store,s.id)}, truncated: e.truncated });
    }
  }
  return { documents, gaps: [...new Set(gaps)], revision: digest(JSON.stringify(documents)) };
}
const INDEX_SQL = `CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(ref UNINDEXED, topic UNINDEXED, text, metadata UNINDEXED, tokenize='porter unicode61');
CREATE TABLE IF NOT EXISTS context_index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS context_vectors (ref TEXT PRIMARY KEY, content_digest TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector_json TEXT NOT NULL);`;
function database(store: StateStore): { db: DatabaseSync; close: () => void } {
  if (store.readOnly) {
    const db = new DatabaseSync(':memory:'); db.exec(INDEX_SQL);
    if (store.db.prepare("SELECT name FROM sqlite_master WHERE name='context_index_meta'").get()) {
      const identity = configured(store.db);
      if (identity) db.prepare("INSERT INTO context_index_meta VALUES ('embeddings',?)").run(JSON.stringify(identity));
      const insert = db.prepare('INSERT INTO context_vectors VALUES (?,?,?,?,?)');
      for (const r of store.db.prepare('SELECT * FROM context_vectors').iterate() as Iterable<{ref:string;content_digest:string;model:string;dimensions:number;vector_json:string}>) insert.run(r.ref,r.content_digest,r.model,r.dimensions,r.vector_json);
    }
    return { db, close: () => db.close() };
  }
  store.db.exec(INDEX_SQL); return { db: store.db, close: () => {} };
}
function sync(db: DatabaseSync, c: Corpus) {
  const row = db.prepare("SELECT value FROM context_index_meta WHERE key='revision'").get() as { value: string } | undefined;
  if (row?.value === c.revision) return;
  // The owning store transaction serializes this cache with canonical updates.
  db.exec('DELETE FROM context_fts');
  const insert = db.prepare('INSERT INTO context_fts(ref,topic,text,metadata) VALUES (?,?,?,?)');
  for (const doc of c.documents) insert.run(doc.ref, doc.topic, doc.text, JSON.stringify(doc));
  db.prepare("INSERT OR REPLACE INTO context_index_meta VALUES ('revision',?)").run(c.revision);
  // Retained vectors must still name exactly the admitted bytes.
  db.exec(`DELETE FROM context_vectors WHERE NOT EXISTS (SELECT 1 FROM context_fts f WHERE json_extract(f.metadata,'$.embeddingRef')=context_vectors.ref AND json_extract(f.metadata,'$.digest')=context_vectors.content_digest)`);
}
export interface EmbeddingIdentity { model: string; dimensions: number }
function embeddingIdentity(raw: EmbeddingIdentity) {
  if (!raw || typeof raw.model !== 'string' || !raw.model.trim() || raw.model.length > 200 || !Number.isSafeInteger(raw.dimensions) || raw.dimensions < 1 || raw.dimensions > 4096) throw new Error('Embedding identity needs a model and dimensions between 1 and 4096');
}
function vector(raw: readonly number[], dimensions: number): number[] {
  if (!Array.isArray(raw) || raw.length !== dimensions || raw.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Embedding vector must contain exactly the configured finite dimensions');
  const norm = Math.hypot(...raw);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding vector must have a finite nonzero norm');
  return raw.map(n => n / norm);
}
export function configureEmbeddings(store: StateStore, identity: EmbeddingIdentity | null) {
  if (store.readOnly) throw new Error('Cannot configure embeddings on a read-only connection');
  if (identity) embeddingIdentity(identity);
  return store.transaction(() => { const { db } = database(store); db.exec('DELETE FROM context_vectors');
    if (identity) db.prepare("INSERT OR REPLACE INTO context_index_meta VALUES ('embeddings',?)").run(JSON.stringify(identity));
    else db.prepare("DELETE FROM context_index_meta WHERE key='embeddings'").run();
    return { enabled: identity !== null, identity, execution: 'supplied vectors only; no model invocation or download' }; });
}
function configured(db: DatabaseSync): EmbeddingIdentity | null {
  const row = db.prepare("SELECT value FROM context_index_meta WHERE key='embeddings'").get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) as EmbeddingIdentity : null;
}
export function putEmbeddings(store: StateStore, input: EmbeddingIdentity & { items: readonly { ref: string; digest: string; vector: readonly number[] }[] }, at: string) {
  if (store.readOnly) throw new Error('Cannot record embeddings on a read-only connection');
  embeddingIdentity(input);
  if (!Array.isArray(input.items) || input.items.length > 200) throw new Error('Supply at most 200 embedding records');
  return store.transaction(() => { const { db } = database(store); const c = corpus(store, at); sync(db, c); const identity = configured(db);
    if (!identity || identity.model !== input.model || identity.dimensions !== input.dimensions) throw new Error('Explicitly configure this embedding identity before recording vectors');
    const insert = db.prepare('INSERT OR REPLACE INTO context_vectors VALUES (?,?,?,?,?)');
    for (const item of input.items) {
      if (!c.documents.some(d => d.embeddingRef === item.ref && d.digest === item.digest)) throw new Error(`Embedding ${item.ref} does not match admitted content bytes`);
      insert.run(item.ref, item.digest, input.model, input.dimensions, JSON.stringify(vector(item.vector, input.dimensions)));
    }
    return { recorded: input.items.length, identity, provenance: 'reported', authorityChanged: false }; });
}
export function contextIndexStatus(store: StateStore) {
  const present = store.db.prepare("SELECT name FROM sqlite_master WHERE name='context_fts'").get();
  if (!present) return { state: 'not_built', documents: 0, embeddings: null, vectors: 0, defaultMode: 'text_and_relationships' };
  return { state: 'rebuildable', documents: (store.db.prepare('SELECT count(*) n FROM context_fts').get() as { n: number }).n,
    embeddings: configured(store.db), vectors: (store.db.prepare('SELECT count(*) n FROM context_vectors').get() as { n: number }).n,
    defaultMode: 'text_and_relationships' };
}
export interface SearchInput {
  query: string; expansions?: readonly string[]; topic?: string; sourceId?: string; limit?: number; budgetChars?: number;
  embedding?: EmbeddingIdentity & { vector: readonly number[] };
}
export function searchContext(store: StateStore, input: SearchInput, at: string) {
  return store.readOnly ? searchAdmittedContext(store,input,at) : store.transaction(() => searchAdmittedContext(store,input,at));
}
function searchAdmittedContext(store: StateStore, input: SearchInput, at: string) {
  const dataVersion = store.readOnly ? Number((store.db.prepare('PRAGMA data_version').get() as {data_version:number}).data_version) : null;
  if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 2000) throw new Error('Context query needs between 1 and 2000 characters');
  if (input.expansions && (!Array.isArray(input.expansions) || input.expansions.length > 8 || input.expansions.some(q => typeof q !== 'string' || q.length > 500))) throw new Error('Supply at most eight bounded query expansions');
  for (const n of [input.limit,input.budgetChars]) if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Search bounds must be finite numbers');
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 12), 50));
  if (input.budgetChars !== undefined && input.budgetChars < 2) throw new Error('Returned-item budget needs at least two characters for an empty result');
  const budget = Math.min(Math.floor(input.budgetChars ?? 12_000), 48_000);
  const c = corpus(store, at), { db, close } = database(store);
  try {
    if (store.readOnly) sync(db, c); else store.transaction(() => sync(db, c));
    type Hit = { doc: ContextDocument; score: number; reasons: string[] };
    const scores = new Map<string, Hit>();
    const gaps = [...c.gaps];
    const eligible = (d: ContextDocument) => (!input.topic || d.topic === input.topic) && (!input.sourceId || d.sourceId === input.sourceId);
    const add = (doc: ContextDocument, score: number, reason: string) => {
      if (!eligible(doc)) return; const prior = scores.get(doc.embeddingRef);
      if (prior) { prior.score += score; if (!prior.reasons.includes(reason)) prior.reasons.push(reason); }
      else scores.set(doc.embeddingRef, { doc, score, reasons: [reason] });
    };
    for (const doc of c.documents) if (doc.ref === input.query || doc.text.toLowerCase().includes(input.query.toLowerCase())) add(doc, 1, 'exact reference or phrase');
    for (const query of [input.query, ...(input.expansions ?? [])]) {
      const tokens = [...new Set<string>(query.match(/[\p{L}\p{N}_]+/gu) ?? [])].filter(t=>!STOP_WORDS.has(t.toLowerCase())).slice(0, 32);
      if (!tokens.length) continue;
      const fts = tokens.map(t => `"${t.replaceAll('"', '""')}"`).join(' OR ');
      const rows = db.prepare(`SELECT metadata, bm25(context_fts) rank FROM context_fts WHERE context_fts MATCH ? AND (?='' OR topic=?) AND (?='' OR json_extract(metadata,'$.sourceId')=?) ORDER BY rank LIMIT 200`).all(fts, input.topic ?? '', input.topic ?? '', input.sourceId ?? '', input.sourceId ?? '') as { metadata: string; rank: number }[];
      if (rows.length === 200) gaps.push('Ranked text candidates reached their bound; additional matching passages may exist.');
      const seen = new Set<string>();
      rows.filter(r => eligible(JSON.parse(r.metadata) as ContextDocument)).forEach((row, rank) => {
        const doc = JSON.parse(row.metadata) as ContextDocument;
        if (!seen.has(doc.embeddingRef)) { seen.add(doc.embeddingRef); add(doc, 1 / (60 + rank), query === input.query ? 'ranked text' : `host expansion ${1 + (input.expansions ?? []).indexOf(query)}`); }
      });
    }
    const identity = configured(db); let vectorCount = 0;
    if (input.embedding) {
      embeddingIdentity(input.embedding);
      if (!identity || identity.model !== input.embedding.model || identity.dimensions !== input.embedding.dimensions) throw new Error('Query embedding identity does not match explicitly configured embeddings');
      const q = vector(input.embedding.vector, identity.dimensions);
      const docs = new Map(c.documents.map(d => [d.embeddingRef, d]));
      const rows = db.prepare('SELECT * FROM context_vectors WHERE model=? AND dimensions=?').all(identity.model, identity.dimensions) as { ref: string; content_digest: string; vector_json: string }[];
      rows.map(r => ({ row: r, doc: docs.get(r.ref), similarity: (JSON.parse(r.vector_json) as number[]).reduce((sum, n, i) => sum + n * q[i]!, 0) }))
        .filter(r => r.doc && r.doc.digest === r.row.content_digest && eligible(r.doc) && r.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity).slice(0, 200).forEach((r, rank) => { vectorCount++; add(r.doc!, 1 / (60 + rank), 'optional embedding'); });
      if (!vectorCount) gaps.push('No compatible document embeddings matched; text retrieval remains available.');
    }
    // Traverse explicit relationships only; a proposed edge stays labeled as such.
    const seeds = new Set([...scores.values()].sort((a,b) => b.score-a.score).slice(0,limit).map(r => r.doc.entityId ?? r.doc.ref.replace(/^entity:/, '')));
    const relationRows = store.db.prepare('SELECT * FROM relations').all() as Record<string, unknown>[];
    for (const edge of relationRows) {
      const from = String(edge.from_id), to = String(edge.to_id);
      const target = seeds.has(from) ? to : seeds.has(to) ? from : null;
      if (target) for (const doc of c.documents) if (doc.entityId === target || doc.ref === `entity:${target}`) add(doc, 1 / 100, `relationship ${String(edge.kind)} (${String(edge.status ?? 'recorded')})`);
    }
    const shown = (h: Hit) => ({ ...h.doc, score: h.score, reasons: h.reasons, content: asPeerData(h.doc.ref, h.doc.text), text: undefined });
    let used = 2; const selected: Hit[] = [];
    const ranked = [...scores.values()].sort((a,b) => b.score-a.score || a.doc.ref.localeCompare(b.doc.ref));
    for (const hit of ranked) {
      if (selected.length >= limit) break;
      const cost = JSON.stringify(shown(hit)).length + (selected.length ? 1 : 0);
      if (used + cost > budget) continue;
      selected.push(hit); used += cost;
    }
    if (dataVersion !== null && Number((store.db.prepare('PRAGMA data_version').get() as {data_version:number}).data_version) !== dataVersion) throw new Error('Project context changed during this read; retry without mixing generations');
    return { items: selected.map(shown),
      revision: c.revision, mode: vectorCount ? 'hybrid' : 'text_and_relationships', query: input.query,
      expansionProvenance: 'host_reported', coverage: { indexedChunks: c.documents.length, matchedDocuments: new Set(ranked.map(h=>h.doc.ref)).size, returnedDocuments: new Set(selected.map(h=>h.doc.ref)).size, returnedChunks: selected.length,
        omittedMatches: ranked.length-selected.length, budgetChars: budget, usedChars: used, gaps: gaps.slice(0,20).map(g=>g.slice(0,512)), gapCount: gaps.length, omittedGapCount: Math.max(0,gaps.length-20) },
      guidance: 'Rank is relevance, not authority or entailment. Inspect citations, status, freshness and gaps. Expand related concepts through the current host when recall is insufficient.' };
  } finally { close(); }
}
export function rebuildContextIndex(store: StateStore, at: string) {
  if (store.readOnly) throw new Error('Cannot rebuild a read-only persistent index');
  return store.transaction(() => { const c = corpus(store, at); const { db } = database(store); db.prepare("DELETE FROM context_index_meta WHERE key='revision'").run(); sync(db,c); return { ...contextIndexStatus(store), revision: c.revision, gaps: c.gaps }; });
}
