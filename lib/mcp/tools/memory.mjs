/**
 * lib/mcp/tools/memory.mjs — Memory and session MCP tools: search, add observations, create entities, recent, session CRUD.
 *
 * Exposes memorySearch, memoryAddObservations, memoryCreateEntities, memoryRecent,
 * sessionList, sessionLoad, sessionSearch, sessionSave.
 * memorySearch is async (hybrid store path); all others are synchronous.
 */
import { resolve } from 'node:path';
import { listSessions, loadSession, searchSessions, updateSession, buildResumeContext } from '../../session-store.mjs';
import { addObservation, searchObservations, listObservations } from '../../observation-store.mjs';
import { createEntity } from '../../entity-store.mjs';
import { buildHybridSearchResultsAsync } from '../../storage/hybrid-query.mjs';

export async function memorySearch(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project || null;
  const limit = args.limit || 10;
  const query = String(args.query || '');

  const obsResults = searchObservations(cwd, query, {
    role: args.role || null,
    category: args.category || null,
    project,
    limit,
  });

  let hybridResults = [];
  try {
    const hybrid = await buildHybridSearchResultsAsync(cwd, query, { limit, env: process.env });
    hybridResults = (hybrid.results || []).map((r) => ({
      ...r,
      source: 'hybrid',
    }));
  } catch { /* best effort — hybrid store is optional */ }

  if (obsResults.length > 0 || hybridResults.length > 0) {
    return {
      observations: obsResults,
      documents: hybridResults,
      total: obsResults.length + hybridResults.length,
    };
  }

  const recent = listObservations(cwd, { project, limit: 5 });
  if (recent.length > 0) {
    return { observations: recent, documents: [], total: recent.length, note: 'No semantic matches — showing recent observations.' };
  }

  return {
    observations: [],
    documents: hybridResults,
    total: hybridResults.length,
    note: hybridResults.length === 0
      ? 'No observations recorded yet. Use memory_add_observations to capture patterns and insights.'
      : undefined,
  };
}

export function memoryAddObservations(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project || cwd.split('/').pop() || 'unknown';
  const observations = (args.observations || []).slice(0, 10);
  const created = [];
  for (const obs of observations) {
    const record = addObservation(cwd, {
      role: obs.role || 'unknown',
      category: obs.category || 'insight',
      summary: obs.summary || '',
      content: obs.content || obs.summary || '',
      tags: obs.tags || [],
      project,
      confidence: obs.confidence ?? 0.8,
      source: obs.source || null,
    });
    if (record) created.push({ id: record.id, summary: record.summary });
  }
  return { created, count: created.length };
}

export function memoryCreateEntities(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project || cwd.split('/').pop() || 'unknown';
  const entities = (args.entities || []).slice(0, 10);
  const created = [];
  for (const ent of entities) {
    const record = createEntity(cwd, {
      name: ent.name || '',
      type: ent.type || 'concept',
      summary: ent.summary || '',
      project,
      observationIds: ent.observation_ids || [],
    });
    if (record) created.push({ name: record.name, type: record.type });
  }
  return { created, count: created.length };
}

export function memoryRecent(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const project = args.project || cwd.split('/').pop() || null;
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
  const raw = listObservations(cwd, { project, limit: limit * 3 });
  const seen = new Set();
  const dedup = [];
  for (const o of raw) {
    const key = `${o.role}::${o.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(o);
    if (dedup.length >= limit) break;
  }
  return { project, count: dedup.length, observations: dedup };
}

export function sessionList(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  return listSessions(cwd, { status: args.status || null, limit: args.limit || 20 });
}

export function sessionLoad(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const session = loadSession(cwd, String(args.session_id));
  if (!session) return { error: 'Session not found: ' + args.session_id };
  return { ...session, resumeContext: buildResumeContext(session) };
}

export function sessionSearch(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  return searchSessions(cwd, String(args.query || ''));
}

export function sessionSave(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const updates = {};
  if (args.summary) updates.summary = args.summary;
  if (args.decisions) updates.decisions = args.decisions;
  if (args.files_changed) updates.filesChanged = args.files_changed;
  if (args.open_questions) updates.openQuestions = args.open_questions;
  if (args.task_snapshot) updates.taskSnapshot = args.task_snapshot;
  if (args.status) updates.status = args.status;
  const updated = updateSession(cwd, String(args.session_id), updates);
  if (!updated) return { error: 'Session not found: ' + args.session_id };
  return updated;
}
