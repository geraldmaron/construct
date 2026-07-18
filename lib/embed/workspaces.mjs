/**
 * lib/embed/workspaces.mjs — Multi-PM workspace management.
 *
 * Workspaces isolate PM workstreams while enabling cross-workspace visibility.
 * Each workspace has an owner (PM), assigned customers, product areas, and a type.
 *
 * Workspace types: 'product' | 'platform' | 'enterprise' | 'growth' | 'ai-product'
 * Default type: 'product'
 *
 * Storage:
 *   ~/.construct/knowledge/internal/workspaces/<workspace-id>.json
 *   ~/.construct/knowledge/internal/workspaces/index.json — quick lookup
 *
 * Intake packets are routed to workspaces based on customer assignment
 * or product area matching. Cross-workspace signals trigger notifications.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { constructDir } from '../paths.mjs';
import { knowledgeInternalStore } from '../knowledge/layout.mjs';

function migrateLegacyDir(modernDir, legacyDir) {
  if (existsSync(modernDir) || !existsSync(legacyDir)) return;
  mkdirSync(join(modernDir, '..'), { recursive: true });
  try { renameSync(legacyDir, modernDir); } catch { /* compatibility-only */ }
}

function workspacePaths({ migrate = false } = {}) {
  const modernDir = join(constructDir(), knowledgeInternalStore('workspaces'));
  const legacyDir = join(constructDir(), 'product-intel', 'workspaces');
  if (migrate) migrateLegacyDir(modernDir, legacyDir);
  const workspacesDir = existsSync(modernDir) || !existsSync(legacyDir) ? modernDir : legacyDir;
  return {
    workspacesDir,
    indexFile: join(workspacesDir, 'index.json'),
  };
}

/**
 * Ensure workspaces directory exists.
 */
function ensureDir() {
  const { workspacesDir } = workspacePaths({ migrate: true });
  if (!existsSync(workspacesDir)) {
    mkdirSync(workspacesDir, { recursive: true });
  }
}

/**
 * Read the index file.
 * @returns {{ [key: string]: { id: string, name: string, owner: string, status: string, type: string } }}
 */
function readIndex() {
  const { indexFile } = workspacePaths();
  if (!existsSync(indexFile)) return {};
  try {
    return JSON.parse(readFileSync(indexFile, 'utf8'));
  } catch (err) {
    process.stderr.write('[workspaces.mjs] readIndex: ' + (err?.message ?? String(err)) + '\n');
    return {};
  }
}

/**
 * Write the index file.
 * @param {object} index
 */
function writeIndex(index) {
  const { indexFile } = workspacePaths();
  ensureDir();
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
}

const VALID_WORKSPACE_TYPES = ['product', 'platform', 'enterprise', 'growth', 'ai-product'];

/**
 * Create a new workspace.
 *
 * @param {object} opts
 * @param {string} opts.name - Workspace name (required)
 * @param {string} opts.owner - PM or owner name (required)
 * @param {string} [opts.description] - Workspace description
 * @param {string[]} [opts.productAreas] - Product areas this workspace covers
 * @param {string[]} [opts.customerIds] - Customer IDs assigned to this workspace
 * @param {string} [opts.type] - Workspace type: 'product' | 'platform' | 'enterprise' | 'growth' | 'ai-product' (default: 'product')
 * @returns {{ id: string, workspace: Workspace }}
 */
export function createWorkspace({ name, owner, description, productAreas = [], customerIds = [], type = 'product' }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('name is required');
  }
  if (!owner || typeof owner !== 'string' || !owner.trim()) {
    throw new Error('owner is required');
  }
  if (!VALID_WORKSPACE_TYPES.includes(type)) {
    throw new Error(`type must be one of: ${VALID_WORKSPACE_TYPES.join(', ')}`);
  }

  ensureDir();

  const id = `ws-${randomUUID().slice(0, 8)}`;
  const workspace = {
    id,
    name: name.trim(),
    owner,
    description: description || '',
    type,
    productAreas,
    customerIds,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const filePath = join(workspacePaths().workspacesDir, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(workspace, null, 2) + '\n');

  // Update index
  const index = readIndex();
  index[id] = {
    id,
    name: workspace.name,
    owner: workspace.owner,
    status: workspace.status,
    type: workspace.type,
  };
  writeIndex(index);

  return { id, workspace };
}

/**
 * Get a workspace by ID.
 * @param {string} workspaceId
 * @returns {Workspace | null}
 */
export function getWorkspace(workspaceId) {
  ensureDir();

  const filePath = join(workspacePaths().workspacesDir, `${workspaceId}.json`);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    process.stderr.write('[workspaces.mjs] getWorkspace: ' + (err?.message ?? String(err)) + '\n');
    return null;
  }
}

/**
 * List all workspaces.
 * @param {object} [opts]
 * @param {string} [opts.owner] - Filter by owner
 * @param {string} [opts.status] - Filter by status
 * @returns {Array<Workspace>}
 */
export function listWorkspaces(opts = {}) {
  ensureDir();

  const index = readIndex();
  let results = Object.values(index).map(entry => getWorkspace(entry.id)).filter(Boolean);

  if (opts.owner) {
    results = results.filter(r => r.owner === opts.owner);
  }

  if (opts.status) {
    results = results.filter(r => r.status === opts.status);
  }

  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Update a workspace.
 *
 * @param {string} workspaceId
 * @param {object} updates
 * @param {string} [updates.name]
 * @param {string} [updates.owner]
 * @param {string} [updates.description]
 * @param {string[]} [updates.productAreas]
 * @param {string[]} [updates.customerIds]
 * @param {string} [updates.status]
 * @param {string} [updates.type] - 'product' | 'platform' | 'enterprise' | 'growth' | 'ai-product'
 * @returns {{ success: boolean, updatedAt: string }}
 */
export function updateWorkspace(workspaceId, updates) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  if (updates.type !== undefined && !VALID_WORKSPACE_TYPES.includes(updates.type)) {
    throw new Error(`type must be one of: ${VALID_WORKSPACE_TYPES.join(', ')}`);
  }

  const updated = {
    ...workspace,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const filePath = join(workspacePaths().workspacesDir, `${workspaceId}.json`);
  writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n');

  // Update index
  const index = readIndex();
  if (index[workspaceId]) {
    index[workspaceId] = {
      id: updated.id,
      name: updated.name,
      owner: updated.owner,
      status: updated.status,
      type: updated.type ?? workspace.type ?? 'product',
    };
    writeIndex(index);
  }

  return { success: true, updatedAt: updated.updatedAt };
}

/**
 * Delete a workspace.
 * @param {string} workspaceId
 * @returns {{ success: boolean }}
 */
export function deleteWorkspace(workspaceId) {
  const filePath = join(workspacePaths().workspacesDir, `${workspaceId}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Remove from filesystem
  const { unlinkSync } = require('node:fs');
  unlinkSync(filePath);

  // Remove from index
  const index = readIndex();
  delete index[workspaceId];
  writeIndex(index);

  return { success: true };
}

/**
 * Route an intake signal to a workspace based on customer or product area.
 *
 * @param {object} signal
 * @param {string} [signal.customerId] - Customer ID if known
 * @param {string} [signal.productArea] - Product area mentioned
 * @param {string} [signal.text] - Signal text for keyword matching
 * @returns {{ workspaceId: string | null, workspaceName: string | null, isCrossWorkspace: boolean, matchedWorkspaces: string[] }}
 */
export function routeSignalToWorkspace(signal) {
  const workspaces = listWorkspaces({ status: 'active' });
  const matchedWorkspaces = [];

  // If customer ID is provided, find workspace that owns this customer
  if (signal.customerId) {
    for (const ws of workspaces) {
      if (ws.customerIds?.includes(signal.customerId)) {
        matchedWorkspaces.push(ws.id);
      }
    }
  }

  // If product area is provided, match workspaces that cover it
  if (signal.productArea) {
    for (const ws of workspaces) {
      if (ws.productAreas?.some(area =>
        area.toLowerCase().includes(signal.productArea.toLowerCase())
      )) {
        if (!matchedWorkspaces.includes(ws.id)) {
          matchedWorkspaces.push(ws.id);
        }
      }
    }
  }

  // If text is provided, do keyword matching on product areas
  if (signal.text && matchedWorkspaces.length === 0) {
    const textLower = signal.text.toLowerCase();
    for (const ws of workspaces) {
      if (ws.productAreas?.some(area => textLower.includes(area.toLowerCase()))) {
        matchedWorkspaces.push(ws.id);
      }
    }
  }

  // Determine routing
  if (matchedWorkspaces.length === 0) {
    // No match — route to default workspace or null
    const defaultWs = workspaces.find(ws => ws.name === 'default') || workspaces[0];
    return {
      workspaceId: defaultWs?.id || null,
      workspaceName: defaultWs?.name || null,
      isCrossWorkspace: false,
      matchedWorkspaces: [],
    };
  }

  if (matchedWorkspaces.length === 1) {
    return {
      workspaceId: matchedWorkspaces[0],
      workspaceName: getWorkspace(matchedWorkspaces[0])?.name || null,
      isCrossWorkspace: false,
      matchedWorkspaces,
    };
  }

  // Multiple matches — this is a cross-workspace signal
  return {
    workspaceId: matchedWorkspaces[0], // Route to first match
    workspaceName: getWorkspace(matchedWorkspaces[0])?.name || null,
    isCrossWorkspace: true,
    matchedWorkspaces,
  };
}

/**
 * Get workspace by owner name.
 * @param {string} ownerName
 * @returns {Workspace | null}
 */
export function getWorkspaceByOwner(ownerName) {
  const workspaces = listWorkspaces({ status: 'active' });
  return workspaces.find(ws => ws.owner === ownerName) || null;
}
