/**
 * tests/graph/build-assurance-edges.test.mjs — Layer 2 assurance edge seeding
 * (lib/graph/build-assurance-edges.mjs) for schema consumers, shared state
 * couplings, and the governed-write execution chain.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { LAYER2_EDGE_RELS } from '../../lib/graph/assurance-edges.mjs';
import { buildAssuranceEdges, KNOWN_COUPLINGS } from '../../lib/graph/build-assurance-edges.mjs';
import { EDGE_RELS } from '../../lib/graph/store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Layer 2 edge rels are registered in EDGE_RELS', () => {
  for (const rel of LAYER2_EDGE_RELS) {
    assert.ok(EDGE_RELS.has(rel), `EDGE_RELS missing ${rel}`);
  }
});

test('buildAssuranceEdges seeds all three Layer 2 relation kinds on this repo', () => {
  const built = buildAssuranceEdges({ rootDir: REPO_ROOT });
  const rels = new Set(built.edges.map((e) => e.rel));
  for (const rel of LAYER2_EDGE_RELS) {
    assert.ok(rels.has(rel), `expected at least one ${rel} edge`);
  }
  assert.ok(built.edges.length >= KNOWN_COUPLINGS.length);
});

test('directive due-tracker coupling is present between daemon and Oracle read-model', () => {
  const built = buildAssuranceEdges({ rootDir: REPO_ROOT });
  const hit = built.edges.find(
    (e) => e.rel === 'couples_state'
      && e.from === 'file:lib/embed/daemon.mjs'
      && e.to === 'file:lib/oracle/read-model.mjs',
  );
  assert.ok(hit, 'expected daemon→read-model couples_state edge');
});

test('governed-write chain is present from write-intent through control-plane', () => {
  const built = buildAssuranceEdges({ rootDir: REPO_ROOT });
  const intentToQueue = built.edges.find(
    (e) => e.rel === 'executes_write'
      && e.from === 'file:lib/writes/write-intent.mjs'
      && e.to === 'file:lib/embed/approval-queue.mjs',
  );
  const queueToPlane = built.edges.find(
    (e) => e.rel === 'executes_write'
      && e.from === 'file:lib/embed/approval-queue.mjs'
      && e.to === 'file:lib/writes/control-plane.mjs',
  );
  assert.ok(intentToQueue, 'expected write-intent→approval-queue executes_write edge');
  assert.ok(queueToPlane, 'expected approval-queue→control-plane executes_write edge');
});

test('project-config schema consumer edge reaches lib/config/schema.mjs', () => {
  const built = buildAssuranceEdges({ rootDir: REPO_ROOT });
  const hit = built.edges.find(
    (e) => e.rel === 'consumes_schema'
      && e.from === 'file:schemas/project-config.schema.json'
      && e.to === 'file:lib/config/schema.mjs',
  );
  assert.ok(hit, 'expected schema→schema.mjs consumes_schema edge');
});
