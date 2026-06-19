/**
 * lib/registry/generate-docs.mjs — generate reference docs from registry/capabilities.json.
 *
 * Writes docs/reference/capabilities.md so the human-readable capability matrix
 * cannot drift from the machine-readable registry.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCapabilityRegistry } from './validate.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

function surfaceSummary(surfaces = {}) {
  return Object.entries(surfaces)
    .filter(([, v]) => v?.supported)
    .map(([name, v]) => {
      const bits = [name];
      if (v.primary) bits.push('primary');
      if (v.tool) bits.push(v.tool);
      if (v.command) bits.push(v.command);
      return bits.join(':');
    })
    .join(', ') || 'none';
}

export function generateCapabilitiesDoc({ rootDir = REPO_ROOT, write = true } = {}) {
  const { capabilities = [] } = loadCapabilityRegistry({ rootDir });
  const byKind = new Map();
  for (const cap of capabilities) {
    const k = cap.kind || 'capability';
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(cap);
  }

  const lines = [
    '---',
    'title: Capability Registry',
    'description: Generated from registry/capabilities.json. Do not edit by hand.',
    '---',
    '',
    '> Generated from `registry/capabilities.json`. Re-run `construct registry:generate-docs` to refresh.',
    '',
    `# Capability Registry (${capabilities.length} entries)`,
    '',
  ];

  for (const [kind, items] of [...byKind.entries()].sort()) {
    lines.push(`## ${kind}`, '');
    lines.push('| ID | Name | Criticality | Surfaces | Human gate | Last validated |');
    lines.push('|---|---|---|---|---|---|');
    for (const cap of items.sort((a, b) => a.id.localeCompare(b.id))) {
      const validated = cap.lastValidated ? cap.lastValidated.slice(0, 10) : 'never';
      lines.push(
        `| \`${cap.id}\` | ${cap.name ?? cap.id} | ${cap.criticality ?? '—'} | ${surfaceSummary(cap.surfaces)} | ${cap.humanGate ?? '—'} | ${validated} |`,
      );
    }
    lines.push('');
  }

  const content = `${lines.join('\n')}\n`;
  const out = path.join(rootDir, 'docs', 'reference', 'capabilities.md');
  if (!write) return { out, content, drift: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') !== content : true };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
  return out;
}

export function checkCapabilitiesDocDrift({ rootDir = REPO_ROOT } = {}) {
  const { content, drift } = generateCapabilitiesDoc({ rootDir, write: false });
  return { drift, contentLength: content.length };
}
