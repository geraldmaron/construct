/**
 * tests/functional/prompt-provenance-graph.functional.test.mjs — prompt provenance graph ingestion.
 *
 * Composes a real Worker Profile with provenance, builds graph nodes, and asserts
 * queryable prompt-fragment/composes_into edges (construct-72gqn.36).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { composePrompt, composePromptWithProvenance } from '../../lib/prompt-composer.mjs';
import { PROMPT_LAYER_ORDER } from '../../lib/prompt-layer-model.mjs';
import { buildFromPrompts } from '../../lib/graph/build-from-prompts.mjs';
import { loadGraph, writeGraph } from '../../lib/graph/store.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const graphTestHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-prompt-graph-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = graphTestHome;
test.after(() => {
  try { fs.rmSync(graphTestHome, { recursive: true, force: true }); } catch { /* skip */ }
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

test('default composePrompt output matches when provenance is disabled', () => {
  const baseline = composePrompt('engineer', { rootDir: REPO, injectLearnedPatterns: false });
  const withFlag = composePrompt('engineer', {
    rootDir: REPO,
    injectLearnedPatterns: false,
    emitProvenance: false,
  });
  assert.equal(withFlag.system, baseline.system);
  assert.deepEqual(withFlag.fragments.map((f) => f.type), baseline.fragments.map((f) => f.type));
  assert.equal(withFlag.provenance, undefined);
});

test('provenance mode records every non-empty contract layer', () => {
  const { composed, provenance } = composePromptWithProvenance('engineer', {
    rootDir: REPO,
    injectLearnedPatterns: false,
  });
  assert.ok(composed.system.length > 0);
  assert.equal(provenance.degraded, false);
  const layers = new Set(provenance.layers.filter((layer) => layer.included).map((layer) => layer.layer));
  assert.ok(layers.has('core'), 'core layer must be present');
  for (const layer of layers) {
    assert.ok(PROMPT_LAYER_ORDER.includes(layer), `unexpected layer ${layer}`);
  }
});

test('buildFromPrompts emits queryable graph nodes for engineer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-graph-'));
  try {
    fs.mkdirSync(path.join(root, '.construct', 'graph'), { recursive: true });
    fs.cpSync(path.join(REPO, 'registry'), path.join(root, 'registry'), { recursive: true });
    fs.cpSync(path.join(REPO, 'skills'), path.join(root, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'prompt-graph-fixture' }, null, 2)}\n`);

    const built = buildFromPrompts({ rootDir: REPO, workerProfileIds: ['engineer'] });
    assert.equal(built.errors.length, 0, built.errors.join('; '));
    assert.ok(built.nodes.some((node) => node.type === 'prompt-fragment'));
    assert.ok(built.nodes.some((node) => node.type === 'composed-prompt'));
    assert.ok(built.edges.some((edge) => edge.rel === 'composes_into'));

    writeGraph(root, {
      nodes: built.nodes,
      edges: built.edges,
      generatedAt: new Date().toISOString(),
    });
    const graph = loadGraph(root);
    const fragment = [...graph.nodes.values()].find((node) => node.type === 'prompt-fragment');
    assert.ok(fragment, 'prompt-fragment node missing after writeGraph');
    const edge = graph.edges.find((row) => row.from === fragment.id && row.rel === 'composes_into');
    assert.ok(edge, 'composes_into edge missing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
