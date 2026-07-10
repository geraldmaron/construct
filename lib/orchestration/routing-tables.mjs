/**
 * lib/orchestration/routing-tables.mjs — declarative routing resolver.
 *
 * Reads specialist subscriptions, doc-artifact ownership, and watch-condition
 * references from specialists/org (with optional .construct/specialists/
 * overlays) and exposes the forward lookups the orchestration layer needs.
 *
 * The resolver is the single source of truth for event/doc/watch routing.
 * Projects override routing without patching library code by dropping JSON
 * files into .construct/specialists/ — each overlay's fields apply over the
 * canonical registry entry for the same specialist.
 *
 * Watch conditions are referenced by name and DECLARED in the registry
 * (specialists/org/watchers.json, construct-pteo2.6): each carries a
 * structured predicate over the requestSignals shape — operators equals /
 * notEquals / gt / truthy, combinators all / any, dot-path field access —
 * evaluated here with unknown operators failing closed. The registry decides
 * WHICH specialist a named watcher routes to; watchers.json decides WHAT
 * condition triggers it. Adding a watcher is a data change, not a code change.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findProjectRoot } from '../project-root.mjs';
import { loadRegistry, clearCache } from '../registry/loader.mjs';
import { configPath } from '../config-dir.mjs';

const ORG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'specialists', 'org');

function fieldValue(signals, fieldPath) {
  return String(fieldPath).split('.').reduce(
    (obj, key) => (obj == null ? undefined : obj[key]),
    signals,
  );
}

function evalCondition(cond, signals) {
  if (!cond || typeof cond !== 'object') return false;
  if (Array.isArray(cond.all)) return cond.all.every((c) => evalCondition(c, signals));
  if (Array.isArray(cond.any)) return cond.any.some((c) => evalCondition(c, signals));
  if (typeof cond.field !== 'string') return false;
  const value = fieldValue(signals, cond.field);
  if ('equals' in cond) return value === cond.equals;
  if ('notEquals' in cond) return value !== cond.notEquals;
  if ('gt' in cond) return typeof value === 'number' && value > cond.gt;
  if ('truthy' in cond) return cond.truthy === true ? Boolean(value) : !value;
  return false;
}

let watcherCache = null;

function loadWatchers() {
  if (watcherCache) return watcherCache;
  const raw = JSON.parse(readFileSync(join(ORG_DIR, 'watchers.json'), 'utf8'));
  const map = {};
  for (const entry of raw.watchers ?? []) {
    if (!entry || typeof entry.name !== 'string' || !entry.condition) continue;
    map[entry.name] = (signals) => evalCondition(entry.condition, signals ?? {});
  }
  watcherCache = map;
  return map;
}

let cache = null;

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function loadOverlays() {
  const root = findProjectRoot();
  if (!root) return [];
  const overlayDir = configPath(root, 'specialists');
  if (!existsSync(overlayDir)) return [];
  const out = [];
  for (const name of readdirSync(overlayDir)) {
    if (!name.endsWith('.json')) continue;
    const data = readJsonSafe(join(overlayDir, name));
    if (data && typeof data === 'object') out.push(data);
  }
  return out;
}

function buildTables() {
  clearCache();
  const registry = loadRegistry();
  if (!registry || typeof registry.specialists !== 'object') {
    throw new Error('routing-tables: assembled registry missing or malformed');
  }

  // Forward maps. Last writer wins for overlays; the resolver validates
  // duplicate ownership inside the canonical registry, so a project overlay
  // is the only way to re-bind a single event/doc/watcher.

  const eventToOwner = new Map();
  const docToOwner = new Map();
  const watcherToOwner = new Map();
  const watcherToReason = new Map();

  const errors = [];

  function apply(entry, source) {
    const cxId = entry.name?.startsWith('cx-') ? entry.name : `cx-${entry.name}`;
    if (Array.isArray(entry.events || entry.subscriptions)) {
      for (const event of (entry.events || entry.subscriptions)) {
        if (eventToOwner.has(event) && eventToOwner.get(event) !== cxId && source === 'registry') {
          errors.push(`duplicate event ownership: ${event} → ${eventToOwner.get(event)} vs ${cxId}`);
        }
        eventToOwner.set(event, cxId);
      }
    }
    if (Array.isArray(entry.docArtifacts)) {
      for (const docType of entry.docArtifacts) {
        if (docToOwner.has(docType) && docToOwner.get(docType) !== cxId && source === 'registry') {
          errors.push(`duplicate doc ownership: ${docType} → ${docToOwner.get(docType)} vs ${cxId}`);
        }
        docToOwner.set(docType, cxId);
      }
    }
    if (Array.isArray(entry.watchConditions)) {
      for (const watch of entry.watchConditions) {
        const name = typeof watch === 'string' ? watch : watch.watcher;
        const reason = typeof watch === 'string' ? null : watch.reason;
        if (!loadWatchers()[name]) {
          errors.push(`unknown watchCondition: ${name} (referenced by ${cxId})`);
          continue;
        }
        watcherToOwner.set(name, cxId);
        if (reason) watcherToReason.set(name, reason);
      }
    }
  }

  for (const entry of Object.values(registry.specialists)) apply(entry, 'registry');
  for (const overlay of loadOverlays()) apply(overlay, 'overlay');

  if (errors.length > 0) {
    throw new Error(`routing-tables: ${errors.join('; ')}`);
  }

  return {
    eventToOwner,
    docToOwner,
    watcherToOwner,
    watcherToReason,
  };
}

function tables() {
  if (!cache) cache = buildTables();
  return cache;
}

export function ownerForEvent(eventType) {
  if (!eventType) return null;
  return tables().eventToOwner.get(eventType) ?? null;
}

export function ownerForDoc(docType) {
  if (!docType) return null;
  return tables().docToOwner.get(docType) ?? null;
}

export function evaluateWatchConditions(signals) {
  const triggers = [];
  const t = tables();
  for (const [name, predicate] of Object.entries(loadWatchers())) {
    const owner = t.watcherToOwner.get(name);
    if (!owner) continue;
    if (!predicate(signals)) continue;
    triggers.push({
      specialist: owner,
      reason: t.watcherToReason.get(name) ?? name,
      watcher: name,
    });
  }
  return triggers;
}

export function knownEventTypes() {
  return Array.from(tables().eventToOwner.keys());
}

export function knownDocTypes() {
  return Array.from(tables().docToOwner.keys());
}

export function knownWatchers() {
  return Object.keys(loadWatchers());
}

/**
 * Evaluate one named watcher predicate against a signals shape, without the
 * registry-ownership binding evaluateWatchConditions applies. Unknown names
 * fail closed. Consumed by the recruiter's participationRules evaluation
 * (ADR-0070 `when.watchCondition`).
 */
export function watcherFires(name, signals) {
  const predicate = loadWatchers()[name];
  if (!predicate) return false;
  return Boolean(predicate(signals ?? {}));
}

/**
 * Get the team id for a specialist.
 * Returns the team id or null if specialist not found.
 */
export function teamForSpecialist(specialistId) {
  if (!specialistId) return null;
  const registry = loadRegistry();
  if (!registry?.specialists) return null;
  const cxId = specialistId.startsWith('cx-') ? specialistId : `cx-${specialistId}`;
  return registry.specialists[cxId]?.team || null;
}

/**
 * Get all specialists in a team.
 * Returns array of specialist ids (with cx- prefix).
 */
export function specialistsInTeam(teamId) {
  if (!teamId) return [];
  const registry = loadRegistry();
  if (!registry?.specialists) return [];
  return Object.entries(registry.specialists)
    .filter(([, s]) => s.team === teamId)
    .map(([id]) => id);
}

/**
 * Get team definition by id.
 * Returns team object or null if not found.
 */
export function getTeamById(teamId) {
  if (!teamId) return null;
  const registry = loadRegistry();
  return registry?.teams?.[teamId] || null;
}

export function _resetCache() {
  cache = null;
  watcherCache = null;
}
