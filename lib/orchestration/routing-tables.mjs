/**
 * lib/orchestration/routing-tables.mjs — declarative routing resolver.
 *
 * Reads Worker Profile events, artifact ownership, and watch-condition
 * references from the canonical registry and exposes the forward lookups the
 * orchestration layer needs.
 *
 * Watch conditions are referenced by name and DECLARED in the registry
 * (registry/watchers.json): each carries a
 * structured predicate over the requestSignals shape — operators equals /
 * notEquals / gt / truthy, combinators all / any, dot-path field access —
 * evaluated here with unknown operators failing closed. The registry decides
 * which Worker Profile a named watcher routes to; watchers.json decides what
 * condition triggers it. Adding a watcher is a data change, not a code change.
 *
 * resolveEventOwner returns the canonical Worker Profile record for dispatch.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, clearCache } from '../registry/loader.mjs';

const REGISTRY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'registry');

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
  const raw = JSON.parse(readFileSync(join(REGISTRY_DIR, 'watchers.json'), 'utf8'));
  const map = {};
  for (const entry of raw.watchers ?? []) {
    if (!entry || typeof entry.name !== 'string' || !entry.condition) continue;
    map[entry.name] = (signals) => evalCondition(entry.condition, signals ?? {});
  }
  watcherCache = map;
  return map;
}

let cache = null;

function buildTables() {
  clearCache();
  const registry = loadRegistry();
  if (!registry || typeof registry.workerProfiles !== 'object') {
    throw new Error('routing-tables: assembled registry missing or malformed');
  }

  const eventToOwner = new Map();
  const docToOwner = new Map();
  const watcherToOwner = new Map();
  const watcherToReason = new Map();

  const errors = [];

  function apply(entry) {
    const workerProfileId = entry.id;
    if (Array.isArray(entry.events)) {
      for (const event of entry.events) {
        if (eventToOwner.has(event) && eventToOwner.get(event) !== workerProfileId) {
          errors.push(`duplicate event ownership: ${event} → ${eventToOwner.get(event)} vs ${workerProfileId}`);
        }
        eventToOwner.set(event, workerProfileId);
      }
    }
    if (Array.isArray(entry.artifactClasses)) {
      for (const docType of entry.artifactClasses) {
        if (docToOwner.has(docType) && docToOwner.get(docType) !== workerProfileId) {
          errors.push(`duplicate doc ownership: ${docType} → ${docToOwner.get(docType)} vs ${workerProfileId}`);
        }
        docToOwner.set(docType, workerProfileId);
      }
    }
    if (Array.isArray(entry.watchConditions)) {
      for (const watch of entry.watchConditions) {
        const name = typeof watch === 'string' ? watch : watch.watcher;
        const reason = typeof watch === 'string' ? null : watch.reason;
        if (!loadWatchers()[name]) {
          errors.push(`unknown watchCondition: ${name} (referenced by ${workerProfileId})`);
          continue;
        }
        watcherToOwner.set(name, workerProfileId);
        if (reason) watcherToReason.set(name, reason);
      }
    }
  }

  for (const entry of Object.values(registry.workerProfiles)) apply(entry);

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

export function resolveEventOwner(event) {
  const type = event?.type;
  if (!type) return null;
  const workerProfileId = ownerForEvent(type);
  if (!workerProfileId) return null;
  const workerProfile = loadRegistry().workerProfiles[workerProfileId];
  return workerProfile ? { workerProfileId, workerProfile } : null;
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
      workerProfile: owner,
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
 * fail closed. Consumed by participation-rule evaluation
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
export function _resetCache() {
  cache = null;
  watcherCache = null;
}
