/**
 * lib/registry/docs-sync.mjs — Sync narrative docs AUTO regions from the capability catalog.
 *
 * Generated regions are machine-owned; surrounding prose stays narrative.
 * Drift is checked via `npm run docs:sync -- --check` in release:check.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCapabilityRegistry } from './validate.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

function replaceRegion(content, regionName, newBody) {
  const open = `<!-- AUTO:${regionName} -->`;
  const close = `<!-- /AUTO:${regionName} -->`;
  const before = content.indexOf(open);
  const after = content.indexOf(close);
  if (before === -1 || after === -1) return null;
  return `${content.slice(0, before + open.length)}\n${newBody}\n${content.slice(after)}`;
}

function buildCatalogDocsRegion(registry) {
  const caps = (registry.capabilities ?? [])
    .filter((cap) => cap.criticality === 'P0' || cap.criticality === 'P1')
    .sort((a, b) => a.id.localeCompare(b.id));

  const lines = [
    '## Capability catalog (generated)',
    '',
    '> Narrative docs index — this table is regenerated from `registry/capabilities.json`.',
    '> Run `npm run docs:sync` after catalog changes. Do not hand-edit inside the AUTO markers.',
    '',
    `Catalog census: ${registry.catalog?.cliCommands?.length ?? 0} CLI commands, `
      + `${registry.catalog?.npmScripts?.length ?? 0} npm scripts, `
      + `${registry.catalog?.workflowTypes?.length ?? 0} embedded workflows.`,
    '',
    '| Capability | Criticality | CLI surface | Verification |',
    '|---|---|---|---|',
  ];

  for (const cap of caps) {
    const cli = cap.surfaces?.cli?.supported ? (cap.surfaces.cli.command || cap.edges?.cliCommands?.[0] || '—') : '—';
    const ver = cap.verification?.functional || cap.verification?.hostEmulation || '—';
    lines.push(`| \`${cap.id}\` | ${cap.criticality} | ${cli} | \`${ver}\` |`);
  }

  return lines.join('\n');
}

export function syncCatalogDocs({ rootDir = REPO_ROOT, check = false } = {}) {
  const readmePath = path.join(rootDir, 'docs', 'README.md');
  const registry = loadCapabilityRegistry({ rootDir });
  const catalogPath = path.join(rootDir, 'registry', 'catalog.json');
  const catalog = fs.existsSync(catalogPath) ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')).catalog : {};
  registry.catalog = catalog;
  const regionBody = buildCatalogDocsRegion(registry);
  const existing = fs.readFileSync(readmePath, 'utf8');
  const next = replaceRegion(existing, 'catalog-sync', regionBody);
  if (!next) {
    return { ok: false, changed: false, error: 'docs/README.md missing AUTO:catalog-sync region' };
  }
  if (next === existing) return { ok: true, changed: false, path: readmePath };
  if (check) return { ok: false, changed: true, path: readmePath, error: 'docs/README.md catalog-sync region drift — run npm run docs:sync' };
  fs.writeFileSync(readmePath, next, 'utf8');
  return { ok: true, changed: true, path: readmePath };
}
