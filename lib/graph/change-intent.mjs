/**
 * lib/graph/change-intent.mjs — pre-change intent records and impact packets.
 *
 * Declares intent to change specific graph targets before edits begin, computes
 * a durable impact packet by reusing lib/graph/impacted.mjs traversal seeded
 * from those targets, and stores both under `.construct/graph/intents/`.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CONFIG_DIR_NAME } from '../config-dir.mjs';
import { computeImpacted } from './impacted.mjs';
import { loadGraph, dependentsOf } from './store.mjs';

const INTENTS_SUBDIR = path.join(CONFIG_DIR_NAME, 'graph', 'intents');

export function intentsDir(rootDir) {
  return path.join(rootDir, INTENTS_SUBDIR);
}

function writeAtomic(filePath, contents) {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, filePath);
}

function normalizeTarget(raw) {
  return String(raw || '').trim().split('\\').join('/').replace(/^\.\//, '');
}

function toPrefixedNodeId(rel) {
  const normalized = normalizeTarget(rel);
  if (normalized.includes(':')) return normalized;
  return (normalized.endsWith('.test.mjs') || normalized.endsWith('.test.js'))
    ? `test:${normalized}`
    : `file:${normalized}`;
}

function targetToChangedFiles(graph, target) {
  const nodeId = toPrefixedNodeId(target);
  if (!graph.nodes.has(nodeId)) return null;

  if (nodeId.startsWith('file:') || nodeId.startsWith('test:')) {
    return [nodeId.slice(nodeId.indexOf(':') + 1)];
  }

  if (nodeId.startsWith('card:') || nodeId.startsWith('demo-manifest:')) {
    const files = [];
    for (const edge of graph.out.get(nodeId) || []) {
      if (edge.rel === 'documents' && edge.to.startsWith('file:')) {
        files.push(edge.to.slice('file:'.length));
      }
      if (edge.rel === 'validates' && edge.to.startsWith('test:')) {
        files.push(edge.to.slice('test:'.length));
      }
    }
    return files.length ? [...new Set(files)] : null;
  }

  if (nodeId.startsWith('capability:')) {
    const files = dependentsOf(graph, nodeId, 'realizes')
      .filter((id) => id.startsWith('file:'))
      .map((id) => id.slice('file:'.length));
    return files.length ? [...new Set(files)] : null;
  }

  return null;
}

function resolveTargets(graph, targets) {
  const normalizedTargets = [...new Set((targets || []).map(normalizeTarget).filter(Boolean))];
  if (normalizedTargets.length === 0) {
    throw new Error('At least one --target is required');
  }

  const unknown = [];
  const changedFiles = new Set();
  const resolvedTargets = [];

  for (const target of normalizedTargets) {
    const nodeId = toPrefixedNodeId(target);
    if (!graph.nodes.has(nodeId)) {
      unknown.push(target);
      continue;
    }
    const files = targetToChangedFiles(graph, target);
    if (!files?.length) {
      unknown.push(target);
      continue;
    }
    resolvedTargets.push(nodeId);
    for (const rel of files) changedFiles.add(rel);
  }

  if (unknown.length) {
    throw new Error(`unknown target: ${unknown.join(', ')}`);
  }

  return {
    targets: resolvedTargets,
    changedFiles: [...changedFiles].sort(),
  };
}

function newIntentId(targets) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const digest = createHash('sha256').update(targets.join('\u0000')).digest('hex').slice(0, 8);
  const nonce = randomBytes(2).toString('hex');
  return `intent-${stamp}-${digest}-${nonce}`;
}

function intentPath(rootDir, intentId) {
  return path.join(intentsDir(rootDir), `${intentId}.json`);
}

function readIntentFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir
 * @param {string[]} opts.targets
 * @returns {{ intent: object, packet: object }}
 */
export function declareChangeIntent({ rootDir, targets }) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) {
    throw new Error('No graph found. Run `construct graph build` first.');
  }

  const resolved = resolveTargets(graph, targets);
  const packet = computeImpacted({ rootDir, changedFiles: resolved.changedFiles });
  const declaredAt = new Date().toISOString();
  const id = newIntentId(resolved.targets);
  const intent = {
    id,
    declaredAt,
    targets: resolved.targets,
    status: 'declared',
    packet,
  };

  const dir = intentsDir(rootDir);
  mkdirSync(dir, { recursive: true });
  writeAtomic(intentPath(rootDir, id), `${JSON.stringify(intent, null, 2)}\n`);

  return intent;
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir
 * @param {string} opts.intentId
 */
export function loadChangeIntent({ rootDir, intentId }) {
  const file = intentPath(rootDir, intentId);
  if (!existsSync(file)) return null;
  return readIntentFile(file);
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir
 * @returns {object[]}
 */
export function listChangeIntents({ rootDir }) {
  const dir = intentsDir(rootDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readIntentFile(path.join(dir, name)))
    .filter(Boolean)
    .sort((a, b) => String(b.declaredAt).localeCompare(String(a.declaredAt)));
}
