/**
 * lib/task-graph/store.mjs — task graph persistence (filesystem adapter).
 *
 * Stores generated graphs under `.cx/task-graphs/<graph-id>.json`. The
 * shape mirrors the in-memory graph from generate.mjs end-to-end so a
 * graph round-trips without lossy field handling. team / enterprise mode
 * will add a Postgres adapter alongside this; both implement the same
 * read / write surface.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configPath } from '../config-dir.mjs';

const STORE_SUBDIR = 'task-graphs';

export function storeDir(rootDir) {
  return configPath(rootDir, STORE_SUBDIR);
}

export class FilesystemTaskGraphStore {
  constructor(rootDir) {
    if (!rootDir) throw new Error('FilesystemTaskGraphStore: rootDir is required');
    this.rootDir = rootDir;
  }

  save(graph) {
    if (!graph?.id) throw new Error('save: graph.id is required');
    const dir = storeDir(this.rootDir);
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${graph.id}.json`);
    writeFileSync(filePath, JSON.stringify(graph, null, 2) + '\n', 'utf8');
    return { id: graph.id, filePath };
  }

  read(id) {
    const filePath = path.join(storeDir(this.rootDir), `${id}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  }

  list() {
    const dir = storeDir(this.rootDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(dir, name))
      .map((filePath) => {
        try {
          return JSON.parse(readFileSync(filePath, 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  updateNodeStatus(graphId, nodeId, status, patch = {}) {
    const graph = this.read(graphId);
    if (!graph) throw new Error(`updateNodeStatus: graph ${graphId} not found`);
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`updateNodeStatus: node ${nodeId} not found in ${graphId}`);
    if (status !== undefined) node.status = status;
    node.updatedAt = new Date().toISOString();
    if (patch.addEvidence) {
      node.evidence = [...(node.evidence || []), patch.addEvidence];
    }
    this.save(graph);
    return node;
  }
}
