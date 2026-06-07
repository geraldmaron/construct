/**
 * tests/e2e/lib.test.mjs — guards for the E2E owner-review scaffolding.
 *
 * The runner and its helpers are themselves load-bearing test infrastructure;
 * a regression in the verdict grid, the command enumeration, the citation
 * validator, or the envelope assertion silently corrupts every scenario report.
 * These tests pin the pure behavior of each helper without standing up a
 * scenario.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeVerdict,
  renderVerdictTable,
  tallyRecommendations,
  RECOMMENDATION,
} from './lib/owner-verdict.mjs';
import { enumerateCommands, planInvocation, EXECUTION_OVERRIDES, SWEEP_MODE } from './lib/command-sweeper.mjs';
import { PEER_ROWS, validateRow, stampAccessDate } from './lib/peer-comparison.mjs';
import { assertEnvelope, assertNoSecrets } from './lib/embed-probes.mjs';

describe('owner-verdict grid', () => {
  it('renders measured cells and marks unmeasured ones with ?', () => {
    const table = renderVerdictTable([
      { label: 'status', verdict: { functions: 'Y', documented: 'Y', discoverable: 'Y', noise: 'low', recommendation: 'ship' } },
      { label: 'mystery', verdict: {} },
    ]);
    assert.match(table, /\| status \| Y \| Y \| Y \| low \| ship \|/);
    assert.match(table, /\| mystery \| \? \| \? \| \? \| \? \| \? \|/);
  });

  it('rejects an out-of-vocabulary verdict value', () => {
    assert.throws(() => normalizeVerdict({ recommendation: 'maybe' }), /not a valid Recommendation/);
  });

  it('tallies recommendations including unmeasured', () => {
    const t = tallyRecommendations([
      { verdict: { recommendation: RECOMMENDATION.SHIP } },
      { verdict: { recommendation: RECOMMENDATION.FILE } },
      { verdict: {} },
    ]);
    assert.deepEqual(t, { ship: 1, iterate: 0, file: 1, unmeasured: 1 });
  });
});

describe('command sweeper enumeration', () => {
  it('partitions the catalog into public and internal with no overlap', () => {
    const { public: pub, internal, all } = enumerateCommands();
    assert.equal(pub.length + internal.length, all.length);
    const names = new Set(pub.map((c) => c.name));
    for (const i of internal) assert.ok(!names.has(i.name), `${i.name} must not be both public and internal`);
  });

  it('routes blocking/mutating commands to help-only, not live run', () => {
    for (const name of Object.keys(EXECUTION_OVERRIDES)) {
      const cmd = enumerateCommands().all.find((c) => c.name === name);
      if (!cmd) continue;
      const plan = planInvocation(cmd);
      assert.notEqual(plan.mode, SWEEP_MODE.RUN, `${name} must not run live in the sweep`);
      assert.ok(plan.reason, `${name} plan must carry a reason`);
    }
  });
});

describe('peer-comparison citation enforcement', () => {
  it('every reference row carries at least one resolvable primary URL', () => {
    for (const row of PEER_ROWS) {
      const v = validateRow(row);
      assert.ok(v.ok, `row ${row.scenario}: ${v.problems.join('; ')}`);
    }
  });

  it('stamping an access date produces a citable row and rejects bad dates', () => {
    const stamped = stampAccessDate(PEER_ROWS[0], '2026-06-06');
    assert.ok(stamped.sources.every((s) => s.accessed === '2026-06-06'));
    assert.throws(() => stampAccessDate(PEER_ROWS[0], 'June 6'), /YYYY-MM-DD/);
  });
});

describe('embed-probe envelope assertion', () => {
  it('accepts a compatible envelope and rejects a missing contractVersion', () => {
    assert.ok(assertEnvelope({ contractVersion: '1.0.0', data: {} }).ok);
    assert.ok(!assertEnvelope({ data: {} }).ok);
  });

  it('flags secret-shaped content in the serialized envelope', () => {
    // Build the synthetic key at runtime so no secret-shaped literal sits in
    // source — the detector still sees a matching string at assert time.
    const fakeKey = 'sk-' + 'x'.repeat(30);
    const res = assertEnvelope({ contractVersion: '1.1.0', token: fakeKey });
    assert.ok(!res.ok);
    assert.ok(res.problems.some((p) => /secret-shaped/.test(p)));
  });

  it('passes a clean payload through the secret scan', () => {
    assert.ok(assertNoSecrets('{"contractVersion":"1.1.0","capabilities":["plan","review"]}').ok);
  });
});
