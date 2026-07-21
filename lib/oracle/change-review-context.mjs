/**
 * lib/oracle/change-review-context.mjs — change-intent and card context for Oracle reviews.
 *
 * Resolves the current review scope from git dirty files, attaches matching
 * change-intent impact packets and Provider/Pattern/Workflow/Contract Card
 * nodes, and surfaces explicit notes when either dimension is unavailable.
 */

import { spawnSync } from 'node:child_process';

import { listChangeIntents } from '../graph/change-intent.mjs';
import { loadGraph, dependentsOf } from '../graph/store.mjs';
import { sqliteAvailable } from '../graph/relational/sqlite-db.mjs';

function gitDirtyFiles(rootDir) {
  try {
    const res = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
    if (res.status !== 0) return [];
    return res.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeScopeFiles(files) {
  return [...new Set((files || []).map((f) => String(f).split('\\').join('/').replace(/^\.\//, '')))].filter(Boolean);
}

function fileNodeIds(scopeFiles) {
  const ids = new Set();
  for (const rel of scopeFiles) {
    ids.add(rel.endsWith('.test.mjs') || rel.endsWith('.test.js') ? `test:${rel}` : `file:${rel}`);
  }
  return ids;
}

function intentCoversScope(intent, scopeFiles) {
  const scope = new Set(normalizeScopeFiles(scopeFiles));
  if (scope.size === 0) return false;
  const packetChanged = new Set(intent.packet?.changed || []);
  if ([...packetChanged].some((rel) => scope.has(rel))) return true;
  for (const target of intent.targets || []) {
    if (scope.has(target)) return true;
    if (target.startsWith('file:') && scope.has(target.slice('file:'.length))) return true;
    if (target.startsWith('test:') && scope.has(target.slice('test:'.length))) return true;
  }
  return false;
}

function cardClaims(node) {
  const attrs = node?.attrs || {};
  return {
    kind: attrs.kind ?? null,
    title: attrs.title ?? node.name ?? null,
    providerId: attrs.providerId ?? null,
    fallback: attrs.fallback ?? null,
    capabilities: attrs.capabilities ?? null,
    sourcePath: attrs.sourcePath ?? null,
  };
}

function cardsForScope(graph, scopeFiles) {
  const scopeIds = fileNodeIds(scopeFiles);
  const cards = [];
  for (const node of graph.nodes.values()) {
    if (node.type !== 'card' && node.type !== 'demo-manifest') continue;
    let matched = false;
    for (const edge of graph.out.get(node.id) || []) {
      if ((edge.rel === 'documents' || edge.rel === 'validates') && scopeIds.has(edge.to)) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;
    cards.push({
      id: node.id,
      name: node.name ?? null,
      type: node.type,
      claims: cardClaims(node),
    });
  }
  return cards.sort((a, b) => a.id.localeCompare(b.id));
}

function layer2Availability(projectDir) {
  if (!sqliteAvailable()) {
    return { available: false, reason: 'relational graph store unavailable on this Node runtime' };
  }
  try {
    const graph = loadGraph(projectDir);
    if (!graph.exists) {
      return { available: false, reason: 'living graph not built' };
    }
    return { available: true };
  } catch (err) {
    return { available: false, reason: err.message || 'living graph unavailable' };
  }
}

function loadGraphSafe(projectDir) {
  try {
    return loadGraph(projectDir);
  } catch {
    return { exists: false };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir
 * @param {string} opts.projectDir
 * @param {string[]} [opts.scopeFiles]
 */
export function collectChangeReviewContext({ rootDir, projectDir, scopeFiles = null }) {
  const scope = normalizeScopeFiles(scopeFiles ?? gitDirtyFiles(rootDir));
  const intents = listChangeIntents({ rootDir: projectDir });
  const matchingIntents = scope.length
    ? intents.filter((intent) => intentCoversScope(intent, scope))
    : intents.slice(0, 1);

  const graph = loadGraphSafe(projectDir);
  const cards = graph.exists ? cardsForScope(graph, scope) : [];

  const layer2 = layer2Availability(projectDir);
  const context = {
    scopeFiles: scope,
    changeIntent: matchingIntents.length
      ? {
          intents: matchingIntents.map((intent) => ({
            id: intent.id,
            declaredAt: intent.declaredAt,
            targets: intent.targets,
            impactPacket: intent.packet,
          })),
        }
      : { note: 'no impact packet available' },
    cards: cards.length
      ? { cards }
      : { note: 'no card coverage' },
    layer2Impact: layer2.available
      ? { available: true }
      : { available: false, note: 'Layer 2 impact analysis unavailable', reason: layer2.reason },
  };

  return context;
}
