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
  validatePostconditions,
  describePostconditions,
} from '../lib/agents/postconditions.mjs';

describe('validatePostconditions', () => {
  it('returns ok for producers without registered rules', () => {
    const r = validatePostconditions('cx-engineer', {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.failures, []);
  });

  it('returns ok for an unknown producer (no rules apply)', () => {
    const r = validatePostconditions('imaginary', {});
    assert.equal(r.ok, true);
  });

  describe('cx-reviewer', () => {
    it('flags an empty review (rubber stamp)', () => {
      const r = validatePostconditions('cx-reviewer', { findings: [] });
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'reviewer.findings-or-explicit-clear');
    });

    it('passes when at least one finding is present', () => {
      const r = validatePostconditions('cx-reviewer', { findings: [{ severity: 'high', summary: 'auth bypass' }] });
      assert.equal(r.ok, true);
    });

    it('passes when reviewer explicitly states "no issues found at <paths>"', () => {
      const r = validatePostconditions('cx-reviewer', { findings: [], noIssuesFoundAt: ['lib/auth.mjs', 'tests/auth.test.mjs'] });
      assert.equal(r.ok, true);
    });

    it('accepts the no-issues-found string form too', () => {
      const r = validatePostconditions('cx-reviewer', { noIssuesFoundStatement: 'no issues found in lib/auth.mjs' });
      assert.equal(r.ok, true);
    });
  });

  describe('cx-security', () => {
    it('flags a missing threat-model timestamp', () => {
      const r = validatePostconditions('cx-security', { contractStart: '2026-05-14T00:00:00Z' });
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'security.threat-model-not-post-hoc');
    });

    it('flags a threat model older than the contract start (retrofitted)', () => {
      const r = validatePostconditions('cx-security', {
        contractStart: '2026-05-14T12:00:00Z',
        threatModelUpdatedAt: '2026-05-13T08:00:00Z',
      });
      assert.equal(r.ok, false);
    });

    it('passes when threat model updated at or after contract start', () => {
      const r = validatePostconditions('cx-security', {
        contractStart: '2026-05-14T00:00:00Z',
        threatModelUpdatedAt: '2026-05-14T05:00:00Z',
      });
      assert.equal(r.ok, true);
    });
  });

  describe('cx-debugger', () => {
    it('flags a missing root-cause source', () => {
      const r = validatePostconditions('cx-debugger', { summary: 'fixed the symptom' });
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'debugger.root-cause-confirmed-via');
    });

    it('flags an unrecognized source (e.g. "intuition")', () => {
      const r = validatePostconditions('cx-debugger', { rootCauseConfirmedVia: 'intuition' });
      assert.equal(r.ok, false);
    });

    it('passes for each of reproduction / trace / test', () => {
      for (const src of ['reproduction', 'trace', 'test']) {
        const r = validatePostconditions('cx-debugger', { rootCauseConfirmedVia: src });
        assert.equal(r.ok, true, `${src} should satisfy the rule`);
      }
    });
  });

  describe('cx-docs-keeper', () => {
    it('flags missing coherence check', () => {
      const r = validatePostconditions('cx-docs-keeper', {});
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'docs-keeper.cross-doc-coherence-check-ran');
    });

    it('flags a true flag without a named diff', () => {
      const r = validatePostconditions('cx-docs-keeper', { crossDocCoherenceCheckRan: true });
      assert.equal(r.ok, false);
    });

    it('passes when both flag and named diff are present', () => {
      const r = validatePostconditions('cx-docs-keeper', {
        crossDocCoherenceCheckRan: true,
        coherenceDiff: 'docs/concepts/architecture.md vs docs/README.md — 4 sections reconciled',
      });
      assert.equal(r.ok, true);
    });
  });

  describe('cx-designer', () => {
    it('flags missing accessibility flag', () => {
      const r = validatePostconditions('cx-designer', { mockup: 'wireframe.html' });
      assert.equal(r.ok, false);
      assert.equal(r.failures[0].id, 'designer.accessibility-check-ran');
    });

    it('passes when accessibilityCheckRan is true', () => {
      const r = validatePostconditions('cx-designer', { accessibilityCheckRan: true });
      assert.equal(r.ok, true);
    });
  });
});

describe('describePostconditions', () => {
  it('returns the rule list for a known producer', () => {
    const rules = describePostconditions('cx-reviewer');
    assert.equal(rules.length, 1);
    assert.match(rules[0].id, /^reviewer\./);
  });

  it('returns empty for an unknown producer', () => {
    assert.deepEqual(describePostconditions('imaginary'), []);
  });
});

describe('POSTCONDITIONS table integrity', () => {
  const expected = ['cx-reviewer', 'cx-security', 'cx-debugger', 'cx-docs-keeper', 'cx-designer'];
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
