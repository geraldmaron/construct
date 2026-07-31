/**
 * tests/registry-characterization.test.mjs
 *
 * Golden characterization of the registry-first extraction targets (
 * opens the architecture-gate / risk R3). These snapshots pin the EXACT current values of the
 * data-shaped lists that are still hardcoded in code, so a Wave-3 extraction into a registry can
 * re-point the import source and prove byte-for-byte that behaviour did not change. No extraction
 * happens here. Only the cleanly-exported targets are snapshotted; non-exported targets are tracked
 * in synthesis/registry-extraction-inventory.md and require an export/consolidation step first.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SELECTABLE_SERVICES } from '../lib/service-manager.mjs';
import { DOC_LANES, LANE_ORDER, DOC_PRESETS, DEFAULT_LANES, LANE_ALIASES } from '../lib/init/doc-lanes.mjs';

test('SELECTABLE_SERVICES is the frozen current roster (service-manager.mjs:276)', () => {
  assert.equal(Object.isFrozen(SELECTABLE_SERVICES), true, 'roster is frozen');
  assert.deepEqual(SELECTABLE_SERVICES, [
    { key: 'telemetry', label: 'Telemetry', description: 'Trace export / local JSONL traces.' },
    { key: 'memory', label: 'Memory (cm)', description: 'Persistent memory service (cm).' },
    { key: 'opencode', label: 'OpenCode', description: 'OpenCode bridge server.' },
    { key: 'copilot-bridge', label: 'Copilot Bridge', description: 'Host-native Copilot bridge proxy (requires gh auth).' },
  ]);
});

test('doc-lane order, presets, and lane set are the current values (doc-lanes.mjs)', () => {
  assert.deepEqual(LANE_ORDER, ['adrs', 'briefs', 'changelogs', 'memos', 'meetings', 'notes', 'onboarding', 'postmortems', 'prds', 'rfcs', 'runbooks']);
  assert.deepEqual(Object.keys(DOC_LANES).sort(), ['adrs', 'briefs', 'changelogs', 'meetings', 'memos', 'notes', 'onboarding', 'postmortems', 'prds', 'rfcs', 'runbooks']);
  assert.deepEqual(DOC_PRESETS, {
    lean: ['adrs', 'memos', 'meetings', 'notes', 'prds'],
    product: ['adrs', 'memos', 'meetings', 'notes', 'prds', 'rfcs'],
    full: ['adrs', 'briefs', 'changelogs', 'memos', 'meetings', 'notes', 'onboarding', 'postmortems', 'prds', 'rfcs', 'runbooks'],
  });
  assert.deepEqual(DEFAULT_LANES, DOC_PRESETS.lean);
});

test('every doc-lane alias resolves to a real lane in LANE_ORDER', () => {
  for (const [alias, lane] of Object.entries(LANE_ALIASES)) {
    assert.ok(LANE_ORDER.includes(lane), `alias "${alias}" resolves to a real lane (${lane})`);
  }
});

// The audit (Agent H) flagged a lane collision: distinct aliases can map to one canonical lane, so a
// project with both directories would be folded together. This pins the current collision so the
// Wave-3 doc-lanes registry preserves (or deliberately changes) it rather than drifting silently.

test('the incident/postmortem alias collision is pinned (current behaviour)', () => {
  assert.equal(LANE_ALIASES.incident, 'postmortems');
  assert.equal(LANE_ALIASES.incidents, 'postmortems');
  assert.equal(LANE_ALIASES.postmortem, 'postmortems');
  assert.equal(LANE_ALIASES.retro, 'meetings');
  assert.equal(LANE_ALIASES.minutes, 'meetings');
  assert.equal(LANE_ALIASES.release, 'changelogs');
  assert.equal(LANE_ALIASES.releases, 'changelogs');
  assert.equal(Object.keys(LANE_ALIASES).length, 28, 'alias table size is pinned');
});
