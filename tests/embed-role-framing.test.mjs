/**
 * tests/embed-role-framing.test.mjs — role framing tests.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getOrientation, buildRoleLens, renderRoleLensSection, _resetCache } from '../lib/embed/role-framing.mjs';

beforeEach(() => _resetCache());

describe('getOrientation', () => {
  it('returns null for null/undefined role', () => {
    assert.equal(getOrientation(null), null);
    assert.equal(getOrientation(undefined), null);
  });

  it('returns embedOrientation for a known agent', () => {
    const orientation = getOrientation('architect');
    assert.ok(orientation, 'architect should have embedOrientation');
    assert.ok(Array.isArray(orientation.focusAreas));
    assert.ok(Array.isArray(orientation.riskSignals));
    assert.ok(Array.isArray(orientation.artifactBias));
  });

  it('returns null for unknown agent', () => {
    assert.equal(getOrientation('nonexistent-agent-xyz'), null);
  });
});

describe('buildRoleLens', () => {
  it('returns null when no roles configured', () => {
    assert.equal(buildRoleLens(null), null);
    assert.equal(buildRoleLens({}), null);
    assert.equal(buildRoleLens({ primary: null, secondary: null }), null);
  });

  it('builds lens from primary role only', () => {
    const lens = buildRoleLens({ primary: 'architect' });
    assert.ok(lens);
    assert.ok(lens.focusAreas.length > 0);
    assert.equal(lens.roles.primary, 'architect');
  });

  it('deduplicates when combining primary and secondary', () => {
    const lens = buildRoleLens({ primary: 'architect', secondary: 'architect' });
    assert.ok(lens);
    // No duplicates
    const unique = [...new Set(lens.focusAreas)];
    assert.deepEqual(lens.focusAreas, unique);
  });
});

describe('renderRoleLensSection', () => {
  it('returns empty string when no roles', () => {
    assert.equal(renderRoleLensSection(null), '');
    assert.equal(renderRoleLensSection({}), '');
  });

  it('renders markdown with Role Lens heading', () => {
    const md = renderRoleLensSection({ primary: 'architect' });
    assert.ok(md.includes('## Role Lens'));
    assert.ok(md.includes('**Primary**: architect'));
  });
});
