#!/usr/bin/env node
/**
 * scripts/patch-registry-readers-v2.mjs — migrate remaining direct JSON readers to loadRegistry.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const files = [
  'lib/embed/role-framing.mjs',
  'lib/graph/build-from-registry.mjs',
  'lib/oracle/org-graph.mjs',
  'lib/doctor/watchers/consistency.mjs',
  'lib/decisions/registry.mjs',
  'lib/mcp/tools/telemetry.mjs',
  'lib/mcp/tools/project.mjs',
  'lib/prompt-metadata.mjs',
  'lib/models/catalog.mjs',
  'lib/auto-docs.mjs',
  'lib/certification/status.mjs',
  'lib/certification/role-overlays.mjs',
  'lib/audit-specialists.mjs',
  'lib/audit-skills.mjs',
  'lib/opencode-runtime-plugin.mjs',
  'lib/reconcile/mcp-entry-reconcile.mjs',
];

function relImport(from, to) {
  let rel = path.relative(path.dirname(from), to).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel.replace(/\.mjs$/, '.mjs');
}

for (const file of files) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) continue;
  let c = fs.readFileSync(abs, 'utf8');
  if (!c.includes('unified-registry.json') && !c.includes('loadRegistry')) continue;

  const importPath = relImport(abs, path.join(ROOT, 'lib/registry/loader.mjs'));
  if (!c.includes("from '../registry/loader.mjs'") && !c.includes('loadRegistry')) {
    if (c.match(/^import /m)) {
      c = c.replace(/^(import .+\n)/m, `$1import { loadRegistry } from '${importPath}';\n`);
    } else {
      c = `import { loadRegistry } from '${importPath}';\n${c}`;
    }
  }

  c = c.replace(
    /JSON\.parse\([^)]*unified-registry\.json[^)]*\)/g,
    'loadRegistry({ rootDir })',
  );
  c = c.replace(
    /readJSON\(join\([^)]*unified-registry\.json[^)]*\)\) \?\? \{\}/g,
    'loadRegistry({ rootDir })',
  );
  c = c.replace(
    /readJsonSafe\(path\.join\([^)]*unified-registry\.json[^)]*\)\)/g,
    'loadRegistry({ rootDir })',
  );
  c = c.replace(
    /readJsonSafe\(registryPath\)/g,
    'loadRegistry({ rootDir })',
  );
  c = c.replace(
    /readJson\(path\.join\(rootDir, 'specialists', 'unified-registry\.json'\)\)/g,
    'loadRegistry({ rootDir })',
  );
  c = c.replace(
    /fs\.existsSync\(path\.join\(current, 'specialists', 'unified-registry\.json'\)\)/g,
    "fs.existsSync(path.join(current, 'specialists', 'org'))",
  );
  c = c.replace(
    /join\([^)]*'specialists', 'unified-registry\.json'\)/g,
    "join(rootDir, 'specialists', 'org')",
  );
  c = c.replace(/specialists\/unified-registry\.json/g, 'specialists/org');

  fs.writeFileSync(abs, c);
  console.log('patched', file);
}

// graph staleness seed list
const staleness = path.join(ROOT, 'lib/graph/staleness.mjs');
let sc = fs.readFileSync(staleness, 'utf8');
sc = sc.replace('specialists/unified-registry.json', 'specialists/org');
fs.writeFileSync(staleness, sc);
