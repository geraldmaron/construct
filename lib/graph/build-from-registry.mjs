/**
 * lib/graph/build-from-registry.mjs — seed the dependency graph from the
 * authoritative declarative catalogs.
 *
 * Ingests registry/capabilities.json, lib/embedded-contract/workflow-defs.mjs,
 * specialists/org into typed nodes and directed edges:
 *   capability --embeds-->     workflow      (embeddedWorkflow)
 *   test       --validates-->  capability    (verification.functional / hostEmulation / per-surface test)
 *   capability --uses-->       skill | rule  (skill + dependencies.skills/.rules)
 *   capability --governed_by-->contract      (contracts[])
 *   capability --exposes-->    surface       (supported surfaces)
 *
 * Extended seeding (LMCP-C1) also produces:
 *   provider   --owned_by-->   specialist    (manifest owner)
 *   provider   --requires-->   tool          (manifest capabilities/operations)
 *   specialist --owned_by-->   specialist    (team membership)
 *   specialist --uses-->       skill         (specialist skills)
 *   doc        --documents-->  workflow|provider (heuristic linking)
 *
 * Node existence on disk (tests, skills, rules) is stamped as an attr so the
 * Oracle collector can later distinguish declared-but-missing from realized.
 * Covers the registry half of the hybrid population; the import-graph half
 * (file/module nodes, imports/covers/realizes) lands in build-import-graph.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { listWorkflowDefs } from '../embedded-contract/workflow-defs.mjs';
import { loadCapabilityRegistry } from '../registry/validate.mjs';
import { nodeId } from './store.mjs';
import { loadManifestsFromDir, resolveManifestDirs } from '../extensions/loader.mjs';
import { assembleRegistry } from '../registry/assemble.mjs';

function readJsonSafe(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return null; }
}

function existsRel(rootDir, rel) {
  return !!rel && existsSync(path.join(rootDir, rel));
}

function declarationImplFiles(cap, rootDir) {
  const files = [];
  if (cap.kind === 'workflow') {
    files.push('lib/embedded-contract/workflow-invoke.mjs', 'lib/embedded-contract/workflow-defs.mjs');
  }
  if (cap.kind === 'document-type') {
    files.push('lib/artifact-release-gate.mjs', 'lib/artifact-manifest.mjs');
  }
  if (cap.id === 'ingest.docling') {
    files.push('lib/document-extract/docling-client.mjs', 'lib/ingest/docling-remote.mjs');
  }
  if (cap.id === 'mcp.tool-budget.trim') {
    files.push('lib/mcp/tool-budget.mjs');
  }
  return [...new Set(files.filter((rel) => existsRel(rootDir, rel)))];
}

const DOC_EXTS = new Set(['.md', '.html', '.json']);

function scanDocFiles(dir, baseDir) {
  const docs = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      docs.push(...scanDocFiles(full, baseDir));
    } else if (entry.isFile() && DOC_EXTS.has(path.extname(entry.name).toLowerCase())) {
      docs.push(path.relative(baseDir, full));
    }
  }
  return docs;
}

function hashFiles(rootDir, rels) {
  const h = createHash('sha256');
  for (const rel of rels) {
    h.update(rel);
    try { h.update(readFileSync(path.join(rootDir, rel))); } catch { h.update('\0missing'); }
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Build the registry-seeded portion of the dependency graph.
 *
 * @param {object} opts
 * @param {string} opts.rootDir — Construct package root holding registry/, specialists/.
 * @returns {{ nodes: object[], edges: object[], sourceHash: string }}
 */
export function buildFromRegistry({ rootDir }) {
  const nodes = [];
  const edges = [];
  const node = (type, key, name, attrs) => nodes.push({ id: nodeId(type, key), type, name: name ?? key, attrs: attrs || {} });
  const edge = (from, rel, to, source) => edges.push({ from, to, rel, source: source || 'registry' });

  // Workflow catalog: every embedded workflow type is a node regardless of
  // capability coverage, so reverse queries see uncovered workflows.

  const workflowDefs = listWorkflowDefs();
  for (const wf of workflowDefs) {
    node('workflow', wf.type, wf.type, {
      tier: wf.tier,
      defaultApprovalMode: wf.defaultApprovalMode,
      chain: wf.chain,
      description: wf.description,
    });
  }

  const contractsDoc = loadRegistry({ rootDir });
   for (const { id, producer, consumer } of Object.values(contractsDoc?.contracts ?? {})) {
     if (!id) continue;
     node('contract', id, id, { producer: producer ?? null, consumer: consumer ?? null });
   }

  const registry = loadCapabilityRegistry({ rootDir });
  for (const cap of registry.capabilities ?? []) {
    if (!cap.id) continue;
    const capNode = nodeId('capability', cap.id);
    node('capability', cap.id, cap.name ?? cap.id, {
      kind: cap.kind ?? 'capability',
      criticality: cap.criticality ?? null,
      humanGate: cap.humanGate ?? null,
      lastValidated: cap.lastValidated ?? null,
      ownerSpecialists: cap.ownerSpecialists ?? [],
      surfaces: cap.surfaces ?? {},
    });

    if (cap.embeddedWorkflow) edge(capNode, 'embeds', nodeId('workflow', cap.embeddedWorkflow));

    const ver = cap.verification ?? {};
    for (const rel of [ver.functional, ver.hostEmulation].filter(Boolean)) {
      const tid = nodeId('test', rel);
      node('test', rel, rel, { path: rel, exists: existsRel(rootDir, rel) });
      edge(tid, 'validates', capNode);
    }

    for (const [surface, status] of Object.entries(cap.surfaces ?? {})) {
      if (!status?.supported) continue;
      node('surface', surface, surface, {});
      edge(capNode, 'exposes', nodeId('surface', surface));
      if (status.primary) {
        const tierTest = path.join('tests', 'capabilities', cap.id, `${surface}.test.mjs`);
        if (existsRel(rootDir, tierTest)) {
          node('test', tierTest, tierTest, { path: tierTest, exists: true });
          edge(nodeId('test', tierTest), 'validates', capNode);
        }
      }
    }

    const skillIds = new Set([cap.skill, ...(cap.dependencies?.skills ?? [])].filter(Boolean));
    for (const sid of skillIds) {
      node('skill', sid, sid, { exists: existsRel(rootDir, path.join('skills', `${sid}.md`)) });
      edge(capNode, 'uses', nodeId('skill', sid));
    }

    for (const rid of cap.dependencies?.rules ?? []) {
      node('rule', rid, rid, { exists: existsRel(rootDir, rid) });
      edge(capNode, 'uses', nodeId('rule', rid));
    }

    for (const cid of cap.contracts ?? []) {
      node('contract', cid, cid, {});
      edge(capNode, 'governed_by', nodeId('contract', cid));
    }

    for (const implRel of declarationImplFiles(cap, rootDir)) {
      const fileNode = nodeId('file', implRel);
      node('file', implRel, implRel, { path: implRel, exists: true, source: 'declaration' });
      edge(fileNode, 'realizes', capNode);
    }
  }

  // --- Provider nodes from extension manifests ---
  // Loads builtin manifests and creates provider, tool, and specialist nodes.
  const manifestDirs = resolveManifestDirs({ rootDir });
  const builtinManifests = loadManifestsFromDir(manifestDirs.builtin);
  const manifests = builtinManifests.manifests || [];

  for (const m of manifests) {
    const provId = nodeId('provider', m.id);
    node('provider', m.id, m.id, {
      kind: m.kind,
      version: m.version,
      owner: m.owner || null,
      capabilities: m.capabilities || [],
      operations: m.operations || [],
    });

    if (m.owner) {
      const specId = nodeId('specialist', m.owner);
      node('specialist', m.owner, m.owner, { autoCreated: true });
      edge(provId, 'owned_by', specId, 'manifest-loader');
    }

    const tokens = new Set([
      ...(m.capabilities || []),
      ...(m.operations || []),
    ]);
    for (const token of tokens) {
      node('tool', token, token, {});
      edge(provId, 'requires', nodeId('tool', token), 'manifest-loader');
    }
  }

  // --- Specialist nodes from role registry ---
  try {
    const orgRegistry = assembleRegistry(rootDir);
    const specialists = orgRegistry.specialists || {};
    const teams = orgRegistry.teams || {};

    for (const [specId, spec] of Object.entries(specialists)) {
      node('specialist', specId, spec.name || specId, {
        role: spec.role || null,
        modelTier: spec.modelTier || null,
        team: spec.team || null,
        teamId: spec.teamId || null,
        groupId: spec.groupId || null,
        skills: spec.skills || [],
      });

      if (spec.teamId && teams[spec.teamId]) {
        edge(nodeId('specialist', specId), 'owned_by', nodeId('specialist', spec.teamId), 'registry');
      }

      for (const skillRef of spec.skills || []) {
        edge(nodeId('specialist', specId), 'uses', nodeId('skill', skillRef), 'registry');
      }
    }
  } catch (err) {
    // specialists/org may not exist in all contexts; skip gracefully
  }

  // --- Doc nodes from docs/ directory ---
  const docsDir = path.join(rootDir, 'docs');
  const docFiles = scanDocFiles(docsDir, rootDir);
  for (const docRel of docFiles) {
    node('doc', docRel, docRel, { path: docRel });
  }

  // --- Documents edges (heuristic linking) ---
  const providerNodeIds = new Set(nodes.filter(n => n.type === 'provider').map(n => n.id));
  const workflowNodeIds = new Set(nodes.filter(n => n.type === 'workflow').map(n => n.id));

  for (const dn of nodes) {
    if (dn.type !== 'doc') continue;
    const docPath = dn.attrs?.path || dn.name || '';

    if (docPath.includes('adr/') && docPath.toLowerCase().includes('workflow')) {
      for (const wfId of workflowNodeIds) {
        edge(dn.id, 'documents', wfId, 'doc-scan');
      }
    }

    if (docPath.includes('adr/') && docPath.toLowerCase().includes('provider')) {
      for (const provId of providerNodeIds) {
        edge(dn.id, 'documents', provId, 'doc-scan');
      }
    }

    if (docPath.includes('adr/') && docPath.toLowerCase().includes('manifest')) {
      for (const provId of providerNodeIds) {
        edge(dn.id, 'documents', provId, 'doc-scan');
      }
    }
  }

  const sourceHash = hashFiles(rootDir, [
    'registry/capabilities.json',
    'specialists/org',
    'lib/embedded-contract/workflow-defs.mjs',
    'lib/embedded-contract/workflows',
    'lib/extensions/manifest-schema.mjs',
    'lib/extensions/loader.mjs',
    'lib/extensions/validate.mjs',
    'lib/extensions/manifests',
    'docs',
    'lib/registry/assemble.mjs',
    'specialists/org',
  ]);

  return { nodes, edges, sourceHash };
}

export { hashFiles };
