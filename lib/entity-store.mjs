/**
 * lib/entity-store.mjs — Entity tracking for the observation store.
 *
 * Tracks recurring entities (components, services, APIs, dependencies)
 * that specialists encounter across sessions. Links entities to
 * observations for "what do we know about X?" queries.
 *
 * Storage: .cx/observations/entities.json — flat JSON array.
 *          .cx/observations/entity-vectors.json — vector index for semantic search.
 */
import fs from 'node:fs';
import path from 'node:path';
import { embedText, cosineSimilarity, rankByBm25 } from './storage/embeddings.mjs';

const OBS_DIR = '.cx/observations';
const ENTITIES_FILE = 'entities.json';
const ENTITY_VECTORS_FILE = 'entity-vectors.json';
const MAX_ENTITIES = 500;
const MAX_SUMMARY = 500;
const MAX_OBSERVATIONS_PER_ENTITY = 50;
const MAX_RELATED = 20;

const VALID_TYPES = new Set([
  'component', 'service', 'dependency', 'api', 'concept', 'file-group',
]);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function entitiesPath(rootDir) {
  return path.join(rootDir, OBS_DIR, ENTITIES_FILE);
}

function entityVectorsPath(rootDir) {
  return path.join(rootDir, OBS_DIR, ENTITY_VECTORS_FILE);
}

function readEntityVectors(rootDir) {
  const p = entityVectorsPath(rootDir);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

function writeEntityVectors(rootDir, records) {
  ensureDir(path.join(rootDir, OBS_DIR));
  fs.writeFileSync(entityVectorsPath(rootDir), JSON.stringify(records.slice(0, MAX_ENTITIES), null, 2) + '\n');
}

function buildEntitySearchText(entity) {
  return [entity.name, entity.summary, entity.type].filter(Boolean).join(' ');
}

function upsertEntityVector(rootDir, entity) {
  const text = buildEntitySearchText(entity);
  if (!text) return;
  const embedding = embedText(text);
  const vectors = readEntityVectors(rootDir);
  const idx = vectors.findIndex((v) => v.name === entity.name);
  const record = { name: entity.name, embedding, type: entity.type || null, project: entity.project || null };
  if (idx >= 0) vectors[idx] = record;
  else vectors.unshift(record);
  writeEntityVectors(rootDir, vectors);
}

function clamp(str, max) {
  if (!str || str.length <= max) return str || null;
  return str.slice(0, max - 1) + '\u2026';
}

function readEntities(rootDir) {
  const p = entitiesPath(rootDir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function writeEntities(rootDir, entities) {
  ensureDir(path.join(rootDir, OBS_DIR));
  const trimmed = entities.slice(0, MAX_ENTITIES);
  fs.writeFileSync(entitiesPath(rootDir), JSON.stringify(trimmed, null, 2) + '\n');
}

/**
 * Create or update an entity. If an entity with the same name exists,
 * its summary and type are updated; observations are merged.
 */
export function createEntity(rootDir, {
  name = '',
  type = 'concept',
  summary = '',
  project = null,
  observationIds = [],
} = {}) {
  if (!name) return null;

  const entities = readEntities(rootDir);
  const effectiveType = VALID_TYPES.has(type) ? type : 'concept';
  const now = new Date().toISOString();
  const normalizedName = String(name).trim().toLowerCase();

  const existing = entities.find((e) => e.name === normalizedName);

  if (existing) {
    existing.type = effectiveType;
    existing.summary = clamp(String(summary || existing.summary), MAX_SUMMARY);
    existing.lastSeen = now;
    if (project) existing.project = String(project);

    const ids = new Set(existing.observations || []);
    for (const id of observationIds) ids.add(String(id));
    existing.observations = [...ids].slice(0, MAX_OBSERVATIONS_PER_ENTITY);

    writeEntities(rootDir, entities);
    upsertEntityVector(rootDir, existing);
    return existing;
  }

  const entity = {
    name: normalizedName,
    type: effectiveType,
    summary: clamp(String(summary), MAX_SUMMARY),
    observations: (Array.isArray(observationIds) ? observationIds : [])
      .map(String)
      .slice(0, MAX_OBSERVATIONS_PER_ENTITY),
    relatedEntities: [],
    project: project ? String(project) : null,
    lastSeen: now,
    createdAt: now,
  };

  entities.unshift(entity);
  writeEntities(rootDir, entities);
  upsertEntityVector(rootDir, entity);
  return entity;
}

/**
 * Link an observation ID to an existing entity.
 */
export function addObservationToEntity(rootDir, entityName, observationId) {
  const entities = readEntities(rootDir);
  const normalizedName = String(entityName).trim().toLowerCase();
  const entity = entities.find((e) => e.name === normalizedName);
  if (!entity) return null;

  const ids = new Set(entity.observations || []);
  ids.add(String(observationId));
  entity.observations = [...ids].slice(0, MAX_OBSERVATIONS_PER_ENTITY);
  entity.lastSeen = new Date().toISOString();

  writeEntities(rootDir, entities);
  return entity;
}

/**
 * Add a related entity link (bidirectional).
 */
export function addRelatedEntity(rootDir, entityNameA, entityNameB) {
  const entities = readEntities(rootDir);
  const nameA = String(entityNameA).trim().toLowerCase();
  const nameB = String(entityNameB).trim().toLowerCase();
  if (nameA === nameB) return null;

  const entityA = entities.find((e) => e.name === nameA);
  const entityB = entities.find((e) => e.name === nameB);

  if (entityA) {
    const related = new Set(entityA.relatedEntities || []);
    related.add(nameB);
    entityA.relatedEntities = [...related].slice(0, MAX_RELATED);
  }
  if (entityB) {
    const related = new Set(entityB.relatedEntities || []);
    related.add(nameA);
    entityB.relatedEntities = [...related].slice(0, MAX_RELATED);
  }

  writeEntities(rootDir, entities);
  return { a: entityA, b: entityB };
}

/**
 * Search entities by keyword in name, summary, or type.
 */
export function searchEntities(rootDir, query, { type = null, project = null } = {}) {
  if (!query) return [];
  const lower = String(query).toLowerCase();

  let entities = readEntities(rootDir);
  if (type) entities = entities.filter((e) => e.type === type);
  if (project) entities = entities.filter((e) => e.project === project);

  const vectors = readEntityVectors(rootDir);
  if (vectors.length === 0) {
    return entities.filter((e) =>
      (e.name && e.name.includes(lower)) ||
      (e.summary && e.summary.toLowerCase().includes(lower)) ||
      (e.type && e.type.includes(lower)),
    );
  }

  const queryEmbedding = embedText(String(query));
  const filteredVectors = vectors.filter((v) =>
    (!type || v.type === type) && (!project || v.project === project)
  );

  const cosineScored = filteredVectors
    .map((v) => ({ name: v.name, score: cosineSimilarity(queryEmbedding, v.embedding || []) }))
    .filter(({ score }) => score > 0.05);

  const candidateNames = new Set(cosineScored.map((v) => v.name));
  for (const e of entities) {
    if ((e.name && e.name.includes(lower)) ||
        (e.summary && e.summary.toLowerCase().includes(lower)) ||
        (e.type && e.type.includes(lower))) {
      candidateNames.add(e.name);
    }
  }

  const candidates = [...candidateNames]
    .map((name) => entities.find((e) => e.name === name))
    .filter(Boolean)
    .map((e) => ({ ...e, text: buildEntitySearchText(e) }));

  const bm25Scored = rankByBm25(candidates, query, { limit: 20 });
  const bm25Max = bm25Scored[0]?.score || 1;

  const scoreMap = new Map();
  for (const { name, score } of cosineScored) scoreMap.set(name, score);
  for (const item of bm25Scored) {
    const prev = scoreMap.get(item.name) || 0;
    scoreMap.set(item.name, Math.max(prev, Math.min(item.score / bm25Max, 1)));
  }

  return [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => entities.find((e) => e.name === name))
    .filter(Boolean);
}

/**
 * Get a single entity by name.
 */
export function getEntity(rootDir, name) {
  const normalizedName = String(name).trim().toLowerCase();
  const entities = readEntities(rootDir);
  return entities.find((e) => e.name === normalizedName) || null;
}

/**
 * List all entities with optional filters.
 */
export function listEntities(rootDir, { type = null, project = null, limit = 50 } = {}) {
  let entities = readEntities(rootDir);
  if (type) entities = entities.filter((e) => e.type === type);
  if (project) entities = entities.filter((e) => e.project === project);
  return entities.slice(0, limit);
}

/**
 * Count entities.
 */
export function countEntities(rootDir, { type = null, project = null } = {}) {
  let entities = readEntities(rootDir);
  if (type) entities = entities.filter((e) => e.type === type);
  if (project) entities = entities.filter((e) => e.project === project);
  return entities.length;
}
