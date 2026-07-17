/**
 * tests/directives/directive-config.test.mjs — directive shape validation
 * and defaults (lib/directives/directive-config.mjs).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateDirective,
  validateDirectives,
  normalizeDirective,
  resolveEffectiveDirectivesFromConfig,
} from '../../lib/directives/directive-config.mjs';

function validDirective(overrides = {}) {
  return {
    id: 'jira-weekly-summary',
    provider: 'jira',
    specialist: 'cx-operations',
    instruction: 'Summarize what the team is working on',
    trigger: { kind: 'interval', intervalMinutes: 10_080 },
    action: 'summarize',
    output: { kind: 'knowledge-note' },
    ...overrides,
  };
}

describe('validateDirective', () => {
  it('accepts a well-formed directive', () => {
    assert.deepEqual(validateDirective(validDirective()), []);
  });

  it('rejects a missing id', () => {
    const { id, ...rest } = validDirective();
    assert.ok(validateDirective(rest).some((e) => e.includes('.id:')));
  });

  it('rejects an invalid trigger kind', () => {
    const errors = validateDirective(validDirective({ trigger: { kind: 'bogus' } }));
    assert.ok(errors.some((e) => e.includes('trigger.kind:')));
  });

  it('rejects an interval trigger with no intervalMinutes', () => {
    const errors = validateDirective(validDirective({ trigger: { kind: 'interval' } }));
    assert.ok(errors.some((e) => e.includes('trigger.intervalMinutes:')));
  });

  it('accepts an on-demand trigger with no intervalMinutes', () => {
    assert.deepEqual(validateDirective(validDirective({ trigger: { kind: 'on-demand' } })), []);
  });

  it('rejects an unknown action', () => {
    const errors = validateDirective(validDirective({ action: 'delete-everything' }));
    assert.ok(errors.some((e) => e.includes('.action:')));
  });

  it('rejects an unknown output kind', () => {
    const errors = validateDirective(validDirective({ output: { kind: 'carrier-pigeon' } }));
    assert.ok(errors.some((e) => e.includes('output.kind:')));
  });

  it('rejects a non-boolean autoRun', () => {
    const errors = validateDirective(validDirective({ autoRun: 'yes' }));
    assert.ok(errors.some((e) => e.includes('.autoRun:')));
  });

  it('rejects an unresolvable specialist when knownSpecialists is supplied', () => {
    const errors = validateDirective(validDirective({ specialist: 'cx-nonexistent' }), 0, {
      knownSpecialists: ['cx-operations', 'cx-product-manager'],
    });
    assert.ok(errors.some((e) => e.includes('.specialist:')));
  });

  it('accepts a bare specialist id matched against a cx-prefixed known list', () => {
    const errors = validateDirective(validDirective({ specialist: 'operations' }), 0, {
      knownSpecialists: ['cx-operations'],
    });
    assert.deepEqual(errors, []);
  });
});

describe('validateDirectives', () => {
  it('returns no errors for undefined (absent block)', () => {
    assert.deepEqual(validateDirectives(undefined), []);
  });

  it('rejects a non-array', () => {
    assert.deepEqual(validateDirectives({}), ['directives: must be an array']);
  });

  it('rejects duplicate ids', () => {
    const errors = validateDirectives([validDirective(), validDirective()]);
    assert.ok(errors.some((e) => e.includes('duplicate id')));
  });

  it('accepts multiple distinct valid directives', () => {
    const errors = validateDirectives([
      validDirective({ id: 'a' }),
      validDirective({ id: 'b' }),
    ]);
    assert.deepEqual(errors, []);
  });
});

describe('normalizeDirective', () => {
  it('defaults autoRun to false when absent', () => {
    const { autoRun, ...rest } = validDirective();
    assert.equal(normalizeDirective(rest).autoRun, false);
  });

  it('preserves an explicit autoRun value', () => {
    assert.equal(normalizeDirective(validDirective({ autoRun: true })).autoRun, true);
  });
});

describe('resolveEffectiveDirectivesFromConfig', () => {
  it('returns an empty array when no directives are configured', () => {
    assert.deepEqual(resolveEffectiveDirectivesFromConfig({}), []);
  });

  it('normalizes every configured directive', () => {
    const resolved = resolveEffectiveDirectivesFromConfig({ directives: [validDirective()] });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].autoRun, false);
  });
});
