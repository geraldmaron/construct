/**
 * lib/graph/build-from-registry.mjs — seed the dependency graph from the
 * authoritative declarative catalogs.
 *
 * Ingests registry/capabilities.json, lib/embedded-contract/workflow-defs.mjs,
 * and specialists/contracts.json into typed nodes and directed edges:
 *   capability --embeds-->     workflow      (embeddedWorkflow)
 *   test       --validates-->  capability    (verification.functional / hostEmulation / per-surface test)
 *   capability --uses-->       skill | rule  (skill + dependencies.skills/.rules)
 *   capability --governed_by-->contract      (contracts[])
 *   capability --exposes-->    surface       (supported surfaces)
 * Node existence on disk (tests, skills, rules) is stamped as an attr so the
 * Oracle collector can later distinguish declared-but-missing from realized.
 * Covers the registry half of the hybrid population; the import-graph half
 * (file/module nodes, imports/covers/realizes) lands in build-import-graph.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { listWorkflowDefs } from '../embedded-contract/workflow-defs.mjs';
import { loadCapabilityRegistry } from '../registry/validate.mjs';
import { nodeId } from './store.mjs';

function readJsonSafe(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return null; }
}

function existsRel(rootDir, rel) {
  return !!rel && existsSync(path.join(rootDir, rel));
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
  const edge = (from, rel, to) => edges.push({ from, to, rel, source: 'registry' });

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

  const contractsDoc = readJsonSafe(path.join(rootDir, 'specialists', 'contracts.json'));
  for (const c of contractsDoc?.contracts ?? []) {
    if (!c?.id) continue;
    node('contract', c.id, c.id, { producer: c.producer ?? null, consumer: c.consumer ?? null });
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
  }

  const sourceHash = hashFiles(rootDir, [
    'registry/capabilities.json',
    'specialists/contracts.json',
    'lib/embedded-contract/workflow-defs.mjs',
  ]);

  return { nodes, edges, sourceHash };
}

export { hashFiles };
