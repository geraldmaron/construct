/**
 * Living capability catalog edges (CLI, npm, Procedures).
 *
 * Regenerates the derived registry/catalog.json projection from CLI commands,
 * package scripts, Procedures, and canonical Capabilities. The owned
 * capability records are never rewritten by catalog generation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_COMMANDS } from '../cli-commands.mjs';
import { PROCEDURE_IDS, listProcedureDefinitions } from '../embedded-contract/procedure-definitions.mjs';
import { loadCapabilityRegistry } from './validate.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'registry', 'catalog.json');

function readPackageScripts(rootDir = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  return Object.keys(pkg.scripts ?? {}).sort();
}

function cliCommandCensus() {
  return CLI_COMMANDS.map((spec) => ({
    name: spec.name,
    category: spec.category || 'Uncategorized',
    core: spec.core === true,
    internal: spec.internal === true,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function tokenizeCliSurface(command = '') {
  const normalized = String(command).replace(/^construct\s+/, '').trim();
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const names = new Set();
  for (let i = 1; i <= tokens.length; i += 1) {
    names.add(tokens.slice(0, i).join(' '));
  }
  return [...names];
}

function npmScriptsForCapability(cap, allScripts, pkgScriptsBody) {
  const hints = new Set([
    ...tokenizeCliSurface(cap.surfaces?.cli?.command),
    ...(cap.verification?.functional ? [cap.verification.functional] : []),
    ...(cap.verification?.hostEmulation ? [cap.verification.hostEmulation] : []),
    cap.id,
  ].filter(Boolean));

  const matched = [];
  for (const scriptName of allScripts) {
    const body = pkgScriptsBody[scriptName] ?? '';
    for (const hint of hints) {
      if (body.includes(hint) || scriptName.includes(hint.replace(/\//g, '-'))) {
        matched.push(scriptName);
        break;
      }
    }
  }
  return [...new Set(matched)].sort();
}

function buildCapabilityEdges(cap, { allScripts, pkgScriptsBody }) {
  const cliCommands = tokenizeCliSurface(cap.surfaces?.cli?.command).sort();
  const procedures = [...(cap.requiredProcedures || [])];
  const npmScripts = npmScriptsForCapability(cap, allScripts, pkgScriptsBody);
  return { cliCommands, npmScripts, procedures };
}

function semanticDigest(cap) {
  const { description = '', criticality = '', verification = {} } = cap;
  return JSON.stringify({ description, criticality, verification });
}

export function buildCatalogSnapshot({ rootDir = REPO_ROOT, now = new Date() } = {}) {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const pkgScriptsBody = pkg.scripts ?? {};
  const allScripts = readPackageScripts(rootDir);
  const raw = loadCapabilityRegistry({ rootDir });
  const capabilityEdges = Object.fromEntries((raw.capabilities ?? []).map((capability) => [capability.id, {
    semanticDigest: semanticDigest(capability),
    ...buildCapabilityEdges(capability, { allScripts, pkgScriptsBody }),
  }]));

  return {
    schemaVersion: 1,
    catalog: {
      generatedAt: now.toISOString(),
      npmScripts: allScripts,
      cliCommands: cliCommandCensus(),
      procedures: listProcedureDefinitions(),
      procedureIds: [...PROCEDURE_IDS],
    },
    capabilityEdges,
  };
}

export function regenerateCapabilityCatalog({ rootDir = REPO_ROOT, now = new Date() } = {}) {
  const snapshot = buildCatalogSnapshot({ rootDir, now });
  fs.writeFileSync(
    path.join(rootDir, 'registry', 'catalog.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
  return {
    path: path.join(rootDir, 'registry', 'catalog.json'),
    capabilityCount: Object.keys(snapshot.capabilityEdges).length,
    npmScriptCount: snapshot.catalog.npmScripts.length,
    cliCommandCount: snapshot.catalog.cliCommands.length,
    procedureCount: snapshot.catalog.procedureIds.length,
  };
}

function stableStringify(value) {
  return JSON.stringify(value);
}

export function checkCapabilityCatalogDrift({ rootDir = REPO_ROOT } = {}) {
  const onDiskPath = path.join(rootDir, 'registry', 'catalog.json');
  if (!fs.existsSync(onDiskPath)) return { drift: true, path: onDiskPath };
  const onDisk = JSON.parse(fs.readFileSync(onDiskPath, 'utf8'));
  const expected = buildCatalogSnapshot({ rootDir });

  const comparable = (doc) => {
    const clone = JSON.parse(JSON.stringify(doc));
    if (clone.catalog) delete clone.catalog.generatedAt;
    return clone;
  };

  if (stableStringify(comparable(onDisk)) !== stableStringify(comparable(expected))) {
    return { drift: true, path: onDiskPath };
  }
  return { drift: false, path: onDiskPath };
}

export function validateCapabilityCatalog({ rootDir = REPO_ROOT } = {}) {
  const errors = [];
  const raw = fs.existsSync(path.join(rootDir, 'registry', 'catalog.json'))
    ? JSON.parse(fs.readFileSync(path.join(rootDir, 'registry', 'catalog.json'), 'utf8'))
    : {};

  if (!raw.catalog) errors.push('registry/catalog.json is missing — run npm run catalog:regen');
  if (!Array.isArray(raw.catalog?.npmScripts) || raw.catalog.npmScripts.length === 0) {
    errors.push('catalog.npmScripts must list package.json scripts');
  }
  if (!Array.isArray(raw.catalog?.cliCommands) || raw.catalog.cliCommands.length === 0) {
    errors.push('catalog.cliCommands must list CLI_COMMANDS census');
  }
  if (!Array.isArray(raw.catalog?.procedureIds) || raw.catalog.procedureIds.length !== PROCEDURE_IDS.length) {
    errors.push('catalog.procedureIds must mirror embedded Procedure definitions');
  }

  for (const [capabilityId, edges] of Object.entries(raw.capabilityEdges ?? {})) {
    if (!Array.isArray(edges.cliCommands)) errors.push(`${capabilityId}: cliCommands must be an array`);
    if (!Array.isArray(edges.npmScripts)) errors.push(`${capabilityId}: npmScripts must be an array`);
    if (!Array.isArray(edges.procedures)) errors.push(`${capabilityId}: procedures must be an array`);
  }

  const drift = checkCapabilityCatalogDrift({ rootDir });
  if (drift.drift) errors.push('capabilities.json catalog edges drift — run npm run catalog:regen');

  return {
    valid: errors.length === 0,
    errors,
    path: CATALOG_PATH,
  };
}
