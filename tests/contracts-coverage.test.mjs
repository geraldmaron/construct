/**
 * tests/contracts-coverage.test.mjs — every specialist in specialists/org
 * must appear as a producer or consumer in at least one typed contract.
 *
 * Closes the Bet 5 contracts gap: dispatch is auditable only if every
 * specialist Construct can route to has a structured handoff. Wildcard
 * producers ('*' as a fallback fanout) count toward consumer coverage but
 * don't satisfy producer coverage for a specific specialist.
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadRegistry } from '../lib/registry/loader.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Specialists whose only routable shape is a fanout from a wildcard producer
// (e.g. construct itself, the orchestrator entrypoint). Excluded from the
// producer/consumer participation check; still validated to appear in the
// registry.
const COVERAGE_EXEMPT = new Set(['orchestrator', 'oracle']);

test('every specialist in unified registry appears as producer or consumer in contracts', () => {
  const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });
  const contracts = Object.values(registry.contracts || {});

  const specialists = Object.values(registry.specialists || {})
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
  const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });
  const contracts = Object.values(registry.contracts || {});
  const seen = new Set();
  for (const c of contracts) {
    assert.match(c.id, /^[a-z0-9][a-z0-9-]*$/, `contract id not kebab-case: ${c.id}`);
    assert.ok(!seen.has(c.id), `duplicate contract id: ${c.id}`);
    seen.add(c.id);
  }
});

test('producer and consumer resolve against registry or well-known names', () => {
  const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });
  const contracts = Object.values(registry.contracts || {});

  const known = new Set();
  for (const a of Object.values(registry.specialists || {})) {
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
