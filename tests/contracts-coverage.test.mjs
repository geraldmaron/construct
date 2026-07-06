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
import { computePostconditionCoverage } from '../lib/contracts/coverage.mjs';
import { POSTCONDITIONS } from '../lib/specialists/postconditions.mjs';

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

// construct-rf26.12: every postcondition across every contract must be
// classified executable or advisory — no bare prose string that reads as
// enforced but isn't (ADR-0015's finding). This is the durable coverage
// measurement the bead asks for; a regression here means a contract shipped
// with an unclassified postcondition.

test('every postcondition on every contract carries a postconditionType', () => {
  const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });
  const contracts = Object.values(registry.contracts || {});
  const offenders = [];
  for (const c of contracts) {
    (c.postconditions || []).forEach((pc, idx) => {
      if (typeof pc !== 'object' || pc === null) {
        offenders.push(`${c.id}[${idx}]: bare postcondition, not an object`);
        return;
      }
      if (pc.postconditionType !== 'executable' && pc.postconditionType !== 'advisory') {
        offenders.push(`${c.id}[${idx}] (${pc.id}): postconditionType is '${pc.postconditionType}', expected executable|advisory`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test('executable postconditions resolve to a real enforcement mechanism', () => {
  const registry = loadRegistry({ rootDir: REPO_ROOT, skipValidation: true });
  const contracts = Object.values(registry.contracts || {});
  const offenders = [];
  for (const c of contracts) {
    for (const pc of c.postconditions || []) {
      if (typeof pc !== 'object' || pc === null || pc.postconditionType !== 'executable') continue;
      if (pc.check) continue; // validated directly by validateArtifactPostconditions
      if (pc.enforcedVia === 'binary-postcondition') {
        const [producer, ruleId] = [Object.keys(POSTCONDITIONS).find((p) => (POSTCONDITIONS[p] || []).some((r) => r.id === pc.enforcedBy)), pc.enforcedBy];
        if (!producer) offenders.push(`${c.id} (${pc.id}): enforcedBy '${ruleId}' does not match any POSTCONDITIONS rule id`);
        continue;
      }
      if (pc.enforcedVia === 'output-shape') {
        if (!pc.enforcedBy) offenders.push(`${c.id} (${pc.id}): output-shape postcondition missing enforcedBy`);
        continue;
      }
      offenders.push(`${c.id} (${pc.id}): executable postcondition has neither 'check' nor a recognized 'enforcedVia'`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('contract postcondition coverage is measured and does not regress below the rf26.11 floor', () => {
  const coverage = computePostconditionCoverage({ repoRoot: REPO_ROOT });
  assert.equal(coverage.unclassified, 0, 'no postcondition should be left unclassified');
  assert.ok(coverage.total > 0, 'expected at least one postcondition across the contract set');
  // construct-rf26.11's roster consolidation deleted 8 contracts that collapsed
  // to intra-role handoffs or were absorbed into standard dispatch (7 of the
  // 43 pre-consolidation contracts became same-role on both sides; an 8th,
  // construct-to-rd-lead, lost its bypass-dispatch rationale when rd-lead
  // retired into cx-architect). That dropped the rf26.12 floor of 39 to 35 —
  // 3 executable checks on construct-to-rd-lead's framing-brief section
  // presence and 1 more were not recreated elsewhere; see ADR-0065 appendix
  // addendum for the accounting.
  assert.ok(
    coverage.executable >= 35,
    `executable postcondition count regressed below the rf26.11 floor (35): got ${coverage.executable}`,
  );
});
