/**
 * lib/registry/catalog.mjs — Living capability catalog edges (CLI, npm, workflows).
 *
 * Regenerates auto-derived `catalog` and per-capability `edges` on
 * registry/capabilities.json from CLI_COMMANDS, package.json scripts, and
 * embedded workflow definitions. Validate recomputes and fails on drift.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_COMMANDS } from '../cli-commands.mjs';
import { WORKFLOW_TYPES, listWorkflowDefs } from '../embedded-contract/workflow-defs.mjs';
import { loadCapabilityRegistry } from './validate.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
const CAPABILITIES_PATH = path.join(REPO_ROOT, 'registry', 'capabilities.json');

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
  const workflows = cap.embeddedWorkflow ? [cap.embeddedWorkflow] : [];
  const npmScripts = npmScriptsForCapability(cap, allScripts, pkgScriptsBody);
  return { cliCommands, npmScripts, workflows };
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
  const capabilities = (raw.capabilities ?? []).map((cap) => ({
    ...cap,
    _semanticDigest: semanticDigest(cap),
    edges: buildCapabilityEdges(cap, { allScripts, pkgScriptsBody }),
  }));

  return {
    version: raw.version ?? 1,
    catalog: {
      generatedAt: now.toISOString(),
      npmScripts: allScripts,
      cliCommands: cliCommandCensus(),
      workflows: listWorkflowDefs().map(({ type, description, tier }) => ({ type, description, tier })),
      workflowTypes: [...WORKFLOW_TYPES],
    },
    capabilities,
  };
}

export function regenerateCapabilityCatalog({ rootDir = REPO_ROOT, now = new Date() } = {}) {
  const snapshot = buildCatalogSnapshot({ rootDir, now });
  fs.writeFileSync(
    path.join(rootDir, 'registry', 'capabilities.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
  return {
    path: path.join(rootDir, 'registry', 'capabilities.json'),
    capabilityCount: snapshot.capabilities.length,
    npmScriptCount: snapshot.catalog.npmScripts.length,
    cliCommandCount: snapshot.catalog.cliCommands.length,
    workflowCount: snapshot.catalog.workflowTypes.length,
  };
}

function stableStringify(value) {
  return JSON.stringify(value);
}

export function checkCapabilityCatalogDrift({ rootDir = REPO_ROOT } = {}) {
  const onDiskPath = path.join(rootDir, 'registry', 'capabilities.json');
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
  const raw = loadCapabilityRegistry({ rootDir });

  if (!raw.catalog) errors.push('capabilities.json missing top-level catalog block — run npm run catalog:regen');
  if (!Array.isArray(raw.catalog?.npmScripts) || raw.catalog.npmScripts.length === 0) {
    errors.push('catalog.npmScripts must list package.json scripts');
  }
  if (!Array.isArray(raw.catalog?.cliCommands) || raw.catalog.cliCommands.length === 0) {
    errors.push('catalog.cliCommands must list CLI_COMMANDS census');
  }
  if (!Array.isArray(raw.catalog?.workflowTypes) || raw.catalog.workflowTypes.length !== WORKFLOW_TYPES.length) {
    errors.push('catalog.workflowTypes must mirror embedded workflow definitions');
  }

  for (const cap of raw.capabilities ?? []) {
    if (!cap.edges) {
      errors.push(`${cap.id}: missing edges — run npm run catalog:regen`);
      continue;
    }
    if (!Array.isArray(cap.edges.cliCommands)) errors.push(`${cap.id}: edges.cliCommands must be an array`);
    if (!Array.isArray(cap.edges.npmScripts)) errors.push(`${cap.id}: edges.npmScripts must be an array`);
    if (!Array.isArray(cap.edges.workflows)) errors.push(`${cap.id}: edges.workflows must be an array`);
    if (cap.embeddedWorkflow && !cap.edges.workflows.includes(cap.embeddedWorkflow)) {
      errors.push(`${cap.id}: edges.workflows must include embeddedWorkflow "${cap.embeddedWorkflow}"`);
    }
  }

  const drift = checkCapabilityCatalogDrift({ rootDir });
  if (drift.drift) errors.push('capabilities.json catalog edges drift — run npm run catalog:regen');

  return {
    valid: errors.length === 0,
    errors,
    path: CAPABILITIES_PATH,
  };
}
