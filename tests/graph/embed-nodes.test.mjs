/**
 * tests/graph/embed-nodes.test.mjs — LMCP-P6 embed nodes in the living graph.
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
import { writeGraph, loadGraph, dependenciesOf, dependentsOf } from '../../lib/graph/store.mjs';
import { validateGraph } from '../../lib/graph/validate.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SHIPPED = [
  { id: 'operations', specialist: 'specialist:cx-operations', contract: 'contract:operations-tpm-briefing', test: 'test:tests/acceptance/tpm-preset.acceptance.test.mjs' },
  { id: 'operations-triage', specialist: 'specialist:cx-operations', contract: 'contract:operations-triage', test: 'test:tests/acceptance/ops-triage-preset.acceptance.test.mjs' },
  { id: 'pm-feedback', specialist: 'specialist:cx-product-manager', contract: 'contract:pm-requirements-candidates', test: 'test:tests/acceptance/pm-feedback-preset.acceptance.test.mjs' },
];

test('buildFromEmbed seeds an embed node + binding edges per manifest', () => {
  const { nodes, edges } = buildFromEmbed({ rootDir: REPO_ROOT });
  const embedNodes = nodes.filter((n) => n.type === 'embed');
  const ids = embedNodes.map((n) => n.id).sort();
  for (const preset of SHIPPED) assert.ok(ids.includes(`embed:${preset.id}`), `missing embed node for ${preset.id}`);

  for (const preset of SHIPPED) {
    const from = `embed:${preset.id}`;
    const hasEdge = (rel, to) => edges.some((e) => e.from === from && e.rel === rel && e.to === to);
    assert.ok(hasEdge('owned_by', preset.specialist), `${preset.id} should own_by ${preset.specialist}`);
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
  // graph.db under the machine-scoped state root (ADR-0066), so it needs its
  // own isolated CX_HOME_OVERRIDE for the duration of the write/validate,
  // restored immediately after so the file's other REPO_ROOT-reading tests
  // keep seeing the real fixture `scripts/ci/build-test-fixtures.sh` built.
  const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-home-'));
  const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = homeOverride;
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
    if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
  }
});

test('the live graph exposes embed nodes with resolved binding targets', () => {
  const graph = loadGraph(REPO_ROOT);
  assert.ok(graph.exists, 'run `construct graph build` first');
  for (const preset of SHIPPED) {
    const id = `embed:${preset.id}`;
    assert.ok(graph.nodes.has(id), `graph missing ${id}`);
    assert.ok(dependenciesOf(graph, id, 'governed_by').includes(preset.contract));
    assert.ok(dependentsOf(graph, id, 'validates').includes(preset.test), `${id} should be validated by ${preset.test}`);
  }
});
