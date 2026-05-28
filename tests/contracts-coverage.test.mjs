/**
 * tests/contracts-coverage.test.mjs — every specialist in specialists/registry.json
 * must appear as a producer or consumer in at least one typed contract.
 *
 * Closes the Bet 5 contracts gap: dispatch is auditable only if every
 * specialist Construct can route to has a structured handoff. Wildcard
 * producers ('*' as a fallback fanout) count toward consumer coverage but
 * don't satisfy producer coverage for a specific specialist.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = join(REPO_ROOT, 'specialists', 'registry.json');
const CONTRACTS_PATH = join(REPO_ROOT, 'specialists', 'contracts.json');

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

// Specialists whose only routable shape is a fanout from a wildcard producer
// (e.g. construct itself, the orchestrator entrypoint). Excluded from the
// producer/consumer participation check; still validated to appear in the
// registry.
const COVERAGE_EXEMPT = new Set(['orchestrator']);

test('every specialist in registry.json appears as producer or consumer in contracts.json', () => {
  const registry = readJson(REGISTRY_PATH);
  const contracts = readJson(CONTRACTS_PATH).contracts || [];

  const specialists = (registry.specialists || [])
    .map((a) => a.name || a.id)
    .filter((n) => typeof n === 'string' && n.length > 0)
    .map((n) => (n.startsWith('cx-') ? n : `cx-${n}`));

  const named = new Set();
  for (const c of contracts) {
    if (c.producer && c.producer !== '*') named.add(c.producer);
    if (c.consumer && c.consumer !== '*') named.add(c.consumer);
  }

  const missing = specialists
    .filter((s) => !COVERAGE_EXEMPT.has(s.replace(/^cx-/, '')))
    .filter((s) => !named.has(s));

  assert.deepEqual(
    missing,
    [],
    `specialists missing from specialists/contracts.json: ${missing.join(', ')}`,
  );
});

test('contract ids are kebab-case and unique', () => {
  const contracts = readJson(CONTRACTS_PATH).contracts || [];
  const seen = new Set();
  for (const c of contracts) {
    assert.match(c.id, /^[a-z0-9][a-z0-9-]*$/, `contract id not kebab-case: ${c.id}`);
    assert.ok(!seen.has(c.id), `duplicate contract id: ${c.id}`);
    seen.add(c.id);
  }
});

test('producer and consumer resolve against registry or well-known names', () => {
  const registry = readJson(REGISTRY_PATH);
  const contracts = readJson(CONTRACTS_PATH).contracts || [];

  const known = new Set();
  for (const a of registry.specialists || []) {
    if (a.name) {
      known.add(a.name);
      known.add(a.name.startsWith('cx-') ? a.name : `cx-${a.name}`);
    }
  }
  if (registry.orchestrator?.name) {
    known.add(registry.orchestrator.name);
  }
  const wellKnownProducers = new Set(['user', 'oncall', 'incident-system', '*', 'construct']);
  const wellKnownConsumers = new Set(['user', 'construct']);

  for (const c of contracts) {
    const producerOk = wellKnownProducers.has(c.producer) || known.has(c.producer);
    const consumerOk = wellKnownConsumers.has(c.consumer) || known.has(c.consumer);
    assert.ok(producerOk, `contract ${c.id}: unknown producer ${c.producer}`);
    assert.ok(consumerOk, `contract ${c.id}: unknown consumer ${c.consumer}`);
  }
});
