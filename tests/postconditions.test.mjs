/**
 * tests/postconditions.test.mjs — hard binary postconditions per producer.
 *
 * Pins the five CF3 round-1 postcondition rules: reviewer must not
 * rubber-stamp, security must not retrofit threat models, debugger must
 * not symptom-fix, docs-keeper must not ship stale docs, designer must
 * not post-hoc accessibility. Each rule has at least one violation and
 * one satisfaction case so the binary contract is unambiguous.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  POSTCONDITIONS,
  validateBinaryPostconditions,
  describePostconditions,
} from '../lib/specialists/postconditions.mjs';

describe('validateBinaryPostconditions', () => {
  it('returns ok for producers without registered rules', () => {
    const r = validateBinaryPostconditions('engineer', {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.failures, []);
  });

  it('returns ok for an unknown producer (no rules apply)', () => {
    const r = validateBinaryPostconditions('imaginary', {});
    assert.equal(r.ok, true);
  });

  describe('reviewer', () => {
    it('flags an empty review (rubber stamp)', () => {
      const r = validateBinaryPostconditions('reviewer', { findings: [] });
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'reviewer.findings-or-explicit-clear');
    });

    it('passes when at least one finding is present', () => {
      const r = validateBinaryPostconditions('reviewer', { findings: [{ severity: 'high', summary: 'auth bypass' }] });
      assert.equal(r.ok, true);
    });

    it('passes when reviewer explicitly states "no issues found at <paths>"', () => {
      const r = validateBinaryPostconditions('reviewer', { findings: [], noIssuesFoundAt: ['lib/auth.mjs', 'tests/auth.test.mjs'] });
      assert.equal(r.ok, true);
    });

    it('accepts the no-issues-found string form too', () => {
      const r = validateBinaryPostconditions('reviewer', { noIssuesFoundStatement: 'no issues found in lib/auth.mjs' });
      assert.equal(r.ok, true);
    });
  });

  describe('security', () => {
    it('flags a missing threat-model timestamp', () => {
      const r = validateBinaryPostconditions('security', { contractStart: '2026-05-14T00:00:00Z' });
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'security.threat-model-not-post-hoc');
    });

    it('flags a threat model older than the contract start (retrofitted)', () => {
      const r = validateBinaryPostconditions('security', {
        contractStart: '2026-05-14T12:00:00Z',
        threatModelUpdatedAt: '2026-05-13T08:00:00Z',
      });
      assert.equal(r.ok, false);
    });

    it('passes when threat model updated at or after contract start', () => {
      const r = validateBinaryPostconditions('security', {
        contractStart: '2026-05-14T00:00:00Z',
        threatModelUpdatedAt: '2026-05-14T05:00:00Z',
      });
      assert.equal(r.ok, true);
    });
  });

  describe('debugger', () => {
    it('flags a missing root-cause source', () => {
      const r = validateBinaryPostconditions('debugger', { summary: 'fixed the symptom' });
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'debugger.root-cause-confirmed-via');
    });

    it('flags an unrecognized source (e.g. "intuition")', () => {
      const r = validateBinaryPostconditions('debugger', { rootCauseConfirmedVia: 'intuition' });
      assert.equal(r.ok, false);
    });

    it('passes for each of reproduction / trace / test', () => {
      for (const src of ['reproduction', 'trace', 'test']) {
        const r = validateBinaryPostconditions('debugger', { rootCauseConfirmedVia: src });
        assert.equal(r.ok, true, `${src} should satisfy the rule`);
      }
    });
  });

  describe('operations', () => {
    it('flags missing coherence check', () => {
      const r = validateBinaryPostconditions('operations', {});
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'docs-keeper.cross-doc-coherence-check-ran');
    });

    it('flags a true flag without a named diff', () => {
      const r = validateBinaryPostconditions('operations', { crossDocCoherenceCheckRan: true });
      assert.equal(r.ok, false);
    });

    it('passes when both flag and named diff are present', () => {
      const r = validateBinaryPostconditions('operations', {
        crossDocCoherenceCheckRan: true,
        coherenceDiff: 'docs/guides/concepts/architecture.md vs docs/README.md — 4 sections reconciled',
      });
      assert.equal(r.ok, true);
    });
  });

  describe('designer', () => {
    it('flags missing accessibility flag', () => {
      const r = validateBinaryPostconditions('designer', { mockup: 'wireframe.html' });
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'designer.accessibility-check-ran');
    });

    it('passes when accessibilityCheckRan is true', () => {
      const r = validateBinaryPostconditions('designer', { accessibilityCheckRan: true });
      assert.equal(r.ok, true);
    });
  });
});

describe('describePostconditions', () => {
  it('returns the rule list for a known producer', () => {
    const rules = describePostconditions('reviewer');
    assert.equal(rules.length, 1);
    assert.match(rules[0].id, /^reviewer\./);
  });

  it('returns empty for an unknown producer', () => {
    assert.deepEqual(describePostconditions('imaginary'), []);
  });
});

describe('POSTCONDITIONS table integrity', () => {
  const expected = ['reviewer', 'security', 'debugger', 'operations', 'designer'];
  for (const producer of expected) {
    it(`has at least one rule for ${producer}`, () => {
      const rules = POSTCONDITIONS[producer];
      assert.ok(Array.isArray(rules) && rules.length >= 1, `missing rules for ${producer}`);
      for (const r of rules) {
        assert.ok(r.id && r.description && typeof r.check === 'function' && r.reason);
      }
    });
  }
});
