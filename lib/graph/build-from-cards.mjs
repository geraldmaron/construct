/**
 * lib/graph/build-from-cards.mjs — ingest Provider/Pattern/Workflow/Contract Cards
 * and Demo Manifests into the living graph.
 *
 * Provider Cards load from registry/provider-cards.json.
 * Pattern, workflow, and contract cards scan registry/cards/<kind>/ and
 * .construct/cards/<kind>/ when those contract beads land standalone files.
 * Demo Manifests load via lib/demo-manifest.mjs. Each card becomes one `card`
 * node (attrs.kind) or `demo-manifest` node with documents/validates/realizes
 * edges to file, test, provider, and capability nodes referenced in the body.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { configPath } from '../config-dir.mjs';
import {
  demoManifestGraphNode,
  listDemoManifestNames,
  loadDemoManifest,
} from '../demo-manifest.mjs';
import { loadProviderCards } from '../providers/provider-card.mjs';
import { nodeId } from './store.mjs';
import { hashFiles } from './build-from-registry.mjs';

const CARD_KINDS = Object.freeze(['pattern', 'workflow', 'contract']);
const REPO_PATH_RE = /(?:^|[\s`'"(\[])((?:lib|tests|registry|templates|schemas|bin)\/[\w./-]+\.(?:mjs|json|md|tape))/g;

function existsRel(rootDir, rel) {
  return !!rel && existsSync(path.join(rootDir, rel));
}

function extractRepoPaths(text) {
  if (!text || typeof text !== 'string') return [];
  const out = new Set();
  for (const match of text.matchAll(REPO_PATH_RE)) out.add(match[1]);
  return [...out];
}

function providerImplCandidates(rootDir, providerId) {
  const slug = String(providerId).replace(/^@/, '').replace(/\//g, '-');
  return [
    `lib/providers/${providerId}.mjs`,
    `lib/providers/${slug}.mjs`,
    `lib/ingest/${providerId}.mjs`,
    `lib/document-extract/${slug}.mjs`,
  ].filter((rel) => existsRel(rootDir, rel));
}

function providerTestCandidates(rootDir, providerId) {
  const slug = String(providerId).replace(/^@/, '').replace(/\//g, '-');
  return [
    `tests/providers/${slug}-provider.test.mjs`,
    `tests/providers/${providerId}-provider.test.mjs`,
    `tests/functional/${slug}-provider.functional.test.mjs`,
    `tests/functional/${providerId}-provider.functional.test.mjs`,
  ].filter((rel) => existsRel(rootDir, rel));
}

function standaloneCardDirs(rootDir, cwd, kind) {
  return [
    path.join(rootDir, 'registry', 'cards', kind),
    configPath(cwd, 'cards', kind),
  ];
}

function scanStandaloneCards(rootDir, cwd, kind) {
  const cards = [];
  for (const dir of standaloneCardDirs(rootDir, cwd, kind)) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const abs = path.join(dir, file);
      let raw;
      try {
        raw = JSON.parse(readFileSync(abs, 'utf8'));
      } catch {
        continue;
      }
      if (!raw?.id) continue;
      cards.push({ kind, card: raw, sourcePath: path.relative(rootDir, abs) });
    }
  }
  return cards;
}

function ensureFileNode(nodes, edges, cardNodeId, rel, rootDir, source) {
  if (!rel) return;
  const normalized = rel.replace(/\\/g, '/');
  if (!existsRel(rootDir, normalized)) return;
  nodes.push({
    id: nodeId('file', normalized),
    type: 'file',
    name: normalized,
    attrs: { path: normalized, exists: true, source: 'card-reference' },
  });
  edges.push({ from: cardNodeId, to: nodeId('file', normalized), rel: 'documents', source });
}

function ensureTestNode(nodes, edges, cardNodeId, rel, rootDir, source) {
  if (!rel) return;
  const normalized = rel.replace(/\\/g, '/');
  if (!existsRel(rootDir, normalized)) return;
  nodes.push({
    id: nodeId('test', normalized),
    type: 'test',
    name: normalized,
    attrs: { path: normalized, exists: true },
  });
  edges.push({ from: cardNodeId, to: nodeId('test', normalized), rel: 'validates', source });
}

function ensureCapabilityEdge(edges, cardNodeId, capId, source) {
  if (!capId) return;
  edges.push({ from: cardNodeId, to: nodeId('capability', capId), rel: 'realizes', source });
}

function ensureProviderEdge(edges, cardNodeId, providerId, source) {
  if (!providerId) return;
  edges.push({ from: cardNodeId, to: nodeId('provider', providerId), rel: 'documents', source });
}

function cardNodeFromProvider(provider, registryRel) {
  const id = nodeId('card', `provider:${provider.id}`);
  return {
    id,
    type: 'card',
    name: provider.id,
    attrs: {
      kind: 'provider',
      providerKind: provider.kind || null,
      owner: provider.owner || null,
      registryPath: registryRel,
    },
  };
}

function cardNodeFromStandalone(kind, card, sourcePath) {
  const id = nodeId('card', `${kind}:${card.id}`);
  return {
    id,
    type: 'card',
    name: card.id,
    attrs: {
      kind,
      sourcePath,
      title: card.title || null,
    },
  };
}

function wireCardReferences({ cardNodeId, card, rootDir, source, nodes, edges }) {
  const fileRefs = new Set([
    ...(Array.isArray(card.files) ? card.files : []),
    ...extractRepoPaths(JSON.stringify(card)),
  ]);
  const testRefs = new Set(Array.isArray(card.tests) ? card.tests : []);
  const capRefs = new Set(Array.isArray(card.capabilities) ? card.capabilities : []);
  if (Array.isArray(card.linkedCapabilities)) {
    for (const capId of card.linkedCapabilities) capRefs.add(capId);
  }

  for (const rel of fileRefs) ensureFileNode(nodes, edges, cardNodeId, rel, rootDir, source);
  for (const rel of testRefs) ensureTestNode(nodes, edges, cardNodeId, rel, rootDir, source);
  for (const capId of capRefs) ensureCapabilityEdge(edges, cardNodeId, capId, source);
}

function wireProviderCard({ rootDir, provider, registryRel, nodes, edges }) {
  const node = cardNodeFromProvider(provider, registryRel);
  nodes.push(node);
  const source = 'card-registry';

  wireCardReferences({
    cardNodeId: node.id,
    card: provider,
    rootDir,
    source,
    nodes,
    edges,
  });

  for (const rel of providerImplCandidates(rootDir, provider.id)) {
    ensureFileNode(nodes, edges, node.id, rel, rootDir, source);
  }
  for (const rel of providerTestCandidates(rootDir, provider.id)) {
    ensureTestNode(nodes, edges, node.id, rel, rootDir, source);
  }
  ensureProviderEdge(edges, node.id, provider.id, source);
}

function wireDemoManifest({ rootDir, cwd, manifest, nodes, edges }) {
  const node = demoManifestGraphNode(manifest);
  nodes.push(node);
  const source = 'card-registry';
  const refs = [
    manifest.script,
    manifest.tape,
    manifest.recording?.spec,
    ...(manifest.commands || []),
  ].filter(Boolean);

  for (const ref of refs) {
    const normalized = String(ref).replace(/\\/g, '/');
    if (normalized.endsWith('.test.mjs')) {
      ensureTestNode(nodes, edges, node.id, normalized, rootDir, source);
    } else {
      ensureFileNode(nodes, edges, node.id, normalized, rootDir, source);
    }
  }
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir — Construct package root.
 * @param {string} [opts.cwd] — active project root for .construct/ overlays.
 * @returns {{ nodes: object[], edges: object[], sourceHash: string }}
 */
export function buildFromCards({ rootDir, cwd = rootDir }) {
  const nodes = [];
  const edges = [];
  const registryRel = 'registry/provider-cards.json';

  const loaded = loadProviderCards({ registryPath: path.join(rootDir, registryRel) });
  if (loaded.ok) {
    for (const provider of loaded.providers) {
      wireProviderCard({ rootDir, provider, registryRel, nodes, edges });
    }
  }

  for (const kind of CARD_KINDS) {
    for (const { kind: cardKind, card, sourcePath } of scanStandaloneCards(rootDir, cwd, kind)) {
      const node = cardNodeFromStandalone(cardKind, card, sourcePath);
      nodes.push(node);
      wireCardReferences({
        cardNodeId: node.id,
        card,
        rootDir,
        source: 'card-registry',
        nodes,
        edges,
      });
    }
  }

  for (const name of listDemoManifestNames({ cwd, repoRoot: rootDir })) {
    const loadedManifest = loadDemoManifest(name, { cwd, repoRoot: rootDir });
    if (!loadedManifest.ok) continue;
    wireDemoManifest({ rootDir, cwd, manifest: loadedManifest.manifest, nodes, edges });
  }

  const sourceHash = hashFiles(rootDir, [
    registryRel,
    'registry/cards',
    'templates/demos/manifests',
    path.join('.construct', 'demos', 'manifests'),
    path.join('.construct', 'cards'),
  ]);

  return { nodes, edges, sourceHash: createHash('sha256').update(sourceHash).digest('hex').slice(0, 16) };
}
