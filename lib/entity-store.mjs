/**
 * lib/entity-store.mjs — Entity tracking for the observation store.
 *
 * Tracks recurring entities (components, services, APIs, dependencies)
 * that specialists encounter across sessions. Links entities to
 * observations for "what do we know about X?" queries.
 *
 * Storage: .cx/observations/entities.json — flat JSON array.
 */
import fs from 'node:fs';
import path from 'node:path';

const OBS_DIR = '.cx/observations';
const ENTITIES_FILE = 'entities.json';
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

  return entities.filter((e) =>
    (e.name && e.name.includes(lower)) ||
    (e.summary && e.summary.toLowerCase().includes(lower)) ||
    (e.type && e.type.includes(lower)),
  );
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
