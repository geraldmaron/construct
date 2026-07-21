/**
 * Assemble the canonical Construct registry from its owned catalogs.
 *
 * Each public registry concept has one physical source. This module performs
 * no translation, overlay merge, identifier rewrite, or compatibility read.
 */

import fs from 'node:fs';
import path from 'node:path';

const CATALOGS = Object.freeze({
  workspacePresets: 'workspace-presets',
  workerProfiles: 'worker-profiles',
  procedures: 'procedures',
  policies: 'policies',
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readCatalog(rootDir, directory) {
  const catalogDir = path.join(rootDir, 'registry', directory);
  if (!fs.existsSync(catalogDir)) {
    throw new Error(`Registry catalog not found: registry/${directory}`);
  }
  const entries = {};
  for (const name of fs.readdirSync(catalogDir).sort()) {
    if (!name.endsWith('.json')) continue;
    const record = readJson(path.join(catalogDir, name));
    const id = name.slice(0, -'.json'.length);
    if (record.id !== id) {
      throw new Error(`Registry file/id mismatch: registry/${directory}/${name} declares ${record.id}`);
    }
    entries[id] = record;
  }
  return entries;
}

function readCapabilities(rootDir) {
  const source = readJson(path.join(rootDir, 'registry', 'capabilities.json'));
  if (source.schemaVersion !== 1 || !Array.isArray(source.capabilities)) {
    throw new Error('registry/capabilities.json must declare schemaVersion 1 and a capabilities array');
  }
  return Object.fromEntries(source.capabilities.map((capability) => [capability.id, capability]));
}

function walkNewestMtime(entry) {
  const stat = fs.statSync(entry);
  if (stat.isFile()) return stat.mtimeMs;
  return Math.max(0, ...fs.readdirSync(entry).map((child) => walkNewestMtime(path.join(entry, child))));
}

export function registryCatalogMtime(rootDir) {
  return walkNewestMtime(path.join(rootDir, 'registry'));
}

export function assembleRegistry(rootDir) {
  return {
    schemaVersion: 1,
    workspacePresets: readCatalog(rootDir, CATALOGS.workspacePresets),
    workerProfiles: readCatalog(rootDir, CATALOGS.workerProfiles),
    procedures: readCatalog(rootDir, CATALOGS.procedures),
    capabilities: readCapabilities(rootDir),
    policies: readCatalog(rootDir, CATALOGS.policies),
  };
}
