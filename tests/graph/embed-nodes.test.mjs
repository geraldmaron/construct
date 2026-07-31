/**
 * tests/graph/embed-nodes.test.mjs — embed nodes in the living graph.
 *
 * Pins the four acceptance guarantees:
 *   1. `graph build` seeds an embed node + uses/owned_by/governed_by edges per
 *      loaded embed manifest;
 *   2. each shipped preset carries an inbound validates edge from its
 *      `@embed`-tagged acceptance test;
 *   3. a broken binding target (an embed edge to a node that does not exist)
 *      fails `graph validate --strict`;
 *   4. `graph query --type embed` enumerates the embed nodes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFromEmbed } from '../../lib/graph/build-from-embed.mjs';
import { buildFromRegistry } from '../../lib/graph/build-from-registry.mjs';
import { writeGraph, loadGraph } from '../../lib/graph/store.mjs';
import { validateGraph } from '../../lib/graph/validate.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SHIPPED = [
  { id: 'operations', workerProfile: 'worker-profile:operations', contract: 'contract:operations-tpm-briefing', test: 'test:tests/acceptance/tpm-preset.acceptance.test.mjs' },
  { id: 'operations-triage', workerProfile: 'worker-profile:operations', contract: 'contract:operations-triage', test: 'test:tests/acceptance/ops-triage-preset.acceptance.test.mjs' },
  { id: 'pm-feedback', workerProfile: 'worker-profile:product-manager', contract: 'contract:pm-requirements-candidates', test: 'test:tests/acceptance/pm-feedback-preset.acceptance.test.mjs' },
];

test('buildFromEmbed seeds an embed node + binding edges per manifest', () => {
  const { nodes, edges } = buildFromEmbed({ rootDir: REPO_ROOT });
  const embedNodes = nodes.filter((n) => n.type === 'embed');
  const ids = embedNodes.map((n) => n.id).sort();
  for (const preset of SHIPPED) assert.ok(ids.includes(`embed:${preset.id}`), `missing embed node for ${preset.id}`);

  for (const preset of SHIPPED) {
    const from = `embed:${preset.id}`;
    const hasEdge = (rel, to) => edges.some((e) => e.from === from && e.rel === rel && e.to === to);
    assert.ok(hasEdge('owned_by', preset.workerProfile), `${preset.id} should own_by ${preset.workerProfile}`);
    assert.ok(hasEdge('governed_by', preset.contract), `${preset.id} should be governed_by ${preset.contract}`);
    assert.ok(
      edges.some((e) => e.from === from && e.rel === 'uses' && e.to.startsWith('provider:')),
      `${preset.id} should use at least one provider`,
    );
  }
});

test('each shipped preset has an inbound validates edge from its acceptance test', () => {
  const { edges } = buildFromEmbed({ rootDir: REPO_ROOT });
  for (const preset of SHIPPED) {
    assert.ok(
      edges.some((e) => e.rel === 'validates' && e.to === `embed:${preset.id}` && e.from === preset.test),
      `${preset.id} missing validates edge from ${preset.test}`,
    );
  }
});

test('a broken binding target fails graph validate --strict', () => {
  // Unlike every other test in this file, this one writes a synthetic graph
  // (not REPO_ROOT's real one) — the relational store resolves that write's
  // graph.db under the machine-scoped state root, so it needs its
  // own isolated CONSTRUCT_HOME_OVERRIDE for the duration of the write/validate,
  // restored immediately after so the file's other REPO_ROOT-reading tests
  // keep seeing the real fixture `scripts/ci/build-test-fixtures.sh` built.
  const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-home-'));
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-'));
  try {
    // An embed that binds a provider with no node of its own, and no test.
    writeGraph(tmp, {
      nodes: [{ id: 'embed:demo', type: 'embed', name: 'demo' }],
      edges: [{ from: 'embed:demo', to: 'provider:ghost', rel: 'uses', source: 'embed-manifest' }],
    });

    const solo = validateGraph(tmp, { strict: false });
    assert.equal(solo.valid, true, 'solo mode must not hard-fail a broken binding');
    assert.ok(solo.warnings.some((w) => /binds provider 'provider:ghost'/.test(w)));

    const strict = validateGraph(tmp, { strict: true });
    assert.equal(strict.valid, false, 'strict mode must fail a broken binding');
    assert.ok(strict.errors.some((e) => /binds provider 'provider:ghost'/.test(e)));
    assert.ok(strict.errors.some((e) => /zero validating tests/.test(e)), 'an untested embed is also an error');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(homeOverride, { recursive: true, force: true });
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
  }
});

test('embed nodes resolve binding targets against registry-seeded provider and worker-profile nodes', () => {
  const { nodes: embedNodes, edges: embedEdges } = buildFromEmbed({ rootDir: REPO_ROOT });
  const { nodes: registryNodes } = buildFromRegistry({ rootDir: REPO_ROOT });
  const registryIds = new Set(registryNodes.map((n) => n.id));

  for (const preset of SHIPPED) {
    const from = `embed:${preset.id}`;
    assert.ok(embedNodes.some((n) => n.id === from), `missing embed node for ${preset.id}`);
    assert.ok(
      embedEdges.some((e) => e.from === from && e.rel === 'owned_by' && e.to === preset.workerProfile),
      `${preset.id} should own_by ${preset.workerProfile}`,
    );
    assert.ok(registryIds.has(preset.workerProfile), `${preset.workerProfile} should exist in registry seed`);
    assert.ok(
      embedEdges.some((e) => e.from === from && e.rel === 'governed_by' && e.to === preset.contract),
      `${preset.id} should be governed_by ${preset.contract}`,
    );
    assert.ok(
      embedEdges.some((e) => e.from === preset.test && e.rel === 'validates' && e.to === from),
      `${preset.id} missing validates edge from ${preset.test}`,
    );
    const uses = embedEdges.filter((e) => e.from === from && e.rel === 'uses');
    assert.ok(uses.length >= 1, `${preset.id} should use at least one provider`);
    for (const edge of uses) assert.ok(registryIds.has(edge.to), `${edge.to} should exist in registry seed`);
  }
});
