/**
 * lib/graph/build-assurance-edges.mjs — seed Layer 2 assurance edges into the graph.
 *
 * Statically records cross-module couplings the oracle-miss-report assigns to
 * change-aware impact analysis: schema consumers, shared durable-state
 * writers/readers, and the write-intent → approval-queue → executor chain.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { LAYER2_EDGE_SOURCE } from './assurance-edges.mjs';
import { nodeId } from './store.mjs';

const SCHEMA_SCAN_ROOTS = ['lib', 'bin', 'scripts'];
const SCHEMA_IMPORT_RES = /\b(?:from|import\()\s*['"]([^'"]*schemas\/[^'"]+)['"]/g;
const SCHEMA_READ_RES = [
  /\breadFileSync\(\s*path\.join\([^)]*['"](schemas\/[^'"]+)['"]/g,
  /\bschemas\/([a-zA-Z0-9._/-]+\.json)\b/g,
];

export const KNOWN_COUPLINGS = Object.freeze([
  {
    rel: 'consumes_schema',
    from: 'file:schemas/project-config.schema.json',
    to: 'file:lib/config/schema.mjs',
    detail: 'FIELD_RULES runtime validator reads the committed project-config schema',
  },
  {
    rel: 'consumes_schema',
    from: 'file:schemas/project-config.schema.json',
    to: 'file:lib/directives/directive-config.mjs',
    detail: 'directive shape validation depends on the project-config schema surface',
  },
  {
    rel: 'consumes_schema',
    from: 'file:schemas/project-config.schema.json',
    to: 'file:lib/config/source-targets.mjs',
    detail: 'source-target normalization consumes project-config fields such as watch',
  },
  {
    rel: 'couples_state',
    from: 'file:lib/embed/daemon.mjs',
    to: 'file:lib/oracle/read-model.mjs',
    detail: 'directive-runner advances lastRunAt while Oracle read-model reads the same due-tracker state',
    stateKey: 'directives/<id>.state.json',
  },
  {
    rel: 'couples_state',
    from: 'file:lib/embed/daemon.mjs',
    to: 'file:lib/directives/due-tracker.mjs',
    detail: 'directive-runner writes per-directive lastRunAt through due-tracker',
    stateKey: 'directives/<id>.state.json',
  },
  {
    rel: 'couples_state',
    from: 'file:lib/oracle/read-model.mjs',
    to: 'file:lib/directives/due-tracker.mjs',
    detail: 'Oracle due-directive collector reads the same lastRunAt ledger',
    stateKey: 'directives/<id>.state.json',
  },
  {
    rel: 'executes_write',
    from: 'file:lib/writes/write-intent.mjs',
    to: 'file:lib/embed/approval-queue.mjs',
    detail: 'write intents are queued for human or policy disposition',
  },
  {
    rel: 'executes_write',
    from: 'file:lib/embed/approval-queue.mjs',
    to: 'file:lib/writes/control-plane.mjs',
    detail: 'approved queue records drain into governed-write execution',
  },
]);

function existsRel(rootDir, rel) {
  return !!rel && existsSync(path.join(rootDir, rel));
}

function edge(from, rel, to, detail) {
  return { from, to, rel, source: LAYER2_EDGE_SOURCE, detail };
}

function walkMjsFiles(dir, baseDir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMjsFiles(full, baseDir, out);
    else if (entry.name.endsWith('.mjs')) out.push(path.relative(baseDir, full));
  }
  return out;
}

function scanSchemaConsumers(rootDir) {
  const schemaNode = nodeId('file', 'schemas/project-config.schema.json');
  if (!existsRel(rootDir, 'schemas/project-config.schema.json')) return [];

  const found = new Set();
  for (const root of SCHEMA_SCAN_ROOTS) {
    const abs = path.join(rootDir, root);
    if (!existsSync(abs)) continue;
    for (const rel of walkMjsFiles(abs, rootDir)) {
      let source;
      try {
        source = readFileSync(path.join(rootDir, rel), 'utf8');
      } catch {
        continue;
      }
      if (!source.includes('schemas/')) continue;

      SCHEMA_IMPORT_RES.lastIndex = 0;
      let m;
      while ((m = SCHEMA_IMPORT_RES.exec(source))) {
        if (m[1].includes('project-config.schema.json')) found.add(rel);
      }
      for (const re of SCHEMA_READ_RES) {
        re.lastIndex = 0;
        while ((m = re.exec(source))) {
          if ((m[1] || m[0]).includes('project-config.schema.json')) found.add(rel);
        }
      }
    }
  }

  return [...found].sort().map((rel) => edge(schemaNode, 'consumes_schema', nodeId('file', rel), `references ${schemaNode}`));
}

function scanStateCouplings(rootDir) {
  const couplings = [];
  const dueTracker = 'lib/directives/due-tracker.mjs';
  if (!existsRel(rootDir, dueTracker)) return couplings;

  const stateRes = [
    { file: 'lib/embed/daemon.mjs', fn: 'writeDirectiveState' },
    { file: 'lib/embed/daemon.mjs', fn: 'readDirectiveState' },
    { file: 'lib/oracle/read-model.mjs', fn: 'readDirectiveState' },
    { file: 'lib/cli/directives.mjs', fn: 'readDirectiveState' },
  ];

  for (const site of stateRes) {
    if (!existsRel(rootDir, site.file)) continue;
    let source;
    try {
      source = readFileSync(path.join(rootDir, site.file), 'utf8');
    } catch {
      continue;
    }
    if (!source.includes(site.fn) || !source.includes('due-tracker')) continue;
    couplings.push(edge(
      nodeId('file', site.file),
      'couples_state',
      nodeId('file', dueTracker),
      `${site.file} ${site.fn} shares directive state via due-tracker`,
    ));
  }

  if (existsRel(rootDir, 'lib/embed/daemon.mjs') && existsRel(rootDir, 'lib/oracle/read-model.mjs')) {
    couplings.push(edge(
      nodeId('file', 'lib/embed/daemon.mjs'),
      'couples_state',
      nodeId('file', 'lib/oracle/read-model.mjs'),
      'directive-runner and Oracle due collector share directive lastRunAt state',
    ));
  }

  return couplings;
}

function scanWriteExecutionChain(rootDir) {
  const chain = [
    ['lib/writes/write-intent.mjs', 'lib/embed/approval-queue.mjs'],
    ['lib/embed/approval-queue.mjs', 'lib/writes/control-plane.mjs'],
    ['lib/writes/control-plane.mjs', 'lib/writes/envelope.mjs'],
  ];
  const edges = [];
  for (const [fromRel, toRel] of chain) {
    if (!existsRel(rootDir, fromRel) || !existsRel(rootDir, toRel)) continue;
    edges.push(edge(
      nodeId('file', fromRel),
      'executes_write',
      nodeId('file', toRel),
      `${fromRel} hands off to ${toRel} in the governed-write pipeline`,
    ));
  }
  return edges;
}

/**
 * @param {{ rootDir: string }} opts
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildAssuranceEdges({ rootDir }) {
  const nodes = new Map();
  const edges = [];

  function ensureNode(id, relPath) {
    if (!nodes.has(id)) nodes.set(id, { id, type: id.split(':')[0], name: relPath || id.slice(id.indexOf(':') + 1) });
  }

  for (const known of KNOWN_COUPLINGS) {
    const fromRel = known.from.slice('file:'.length);
    const toRel = known.to.startsWith('file:') ? known.to.slice('file:'.length) : known.to;
    if (known.from.startsWith('file:') && !existsRel(rootDir, fromRel)) continue;
    if (known.to.startsWith('file:') && !existsRel(rootDir, toRel)) continue;
    ensureNode(known.from, fromRel);
    ensureNode(known.to, toRel);
    edges.push({ from: known.from, to: known.to, rel: known.rel, source: LAYER2_EDGE_SOURCE, detail: known.detail, stateKey: known.stateKey || null });
  }

  for (const scanned of [...scanSchemaConsumers(rootDir), ...scanStateCouplings(rootDir), ...scanWriteExecutionChain(rootDir)]) {
    const fromRel = scanned.from.slice('file:'.length);
    const toRel = scanned.to.slice('file:'.length);
    ensureNode(scanned.from, fromRel);
    ensureNode(scanned.to, toRel);
    edges.push(scanned);
  }

  return { nodes: [...nodes.values()], edges };
}
