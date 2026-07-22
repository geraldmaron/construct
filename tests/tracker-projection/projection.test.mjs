/**
 * tests/tracker-projection/projection.test.mjs — field authority + Projection
 * builder (construct-b0nny.27 / E8).
 *
 * Pure, no I/O: authorityFor classifies bd fields; buildProjection records
 * per-field authority, snapshots field values, and preserves the whole issue
 * verbatim in raw_record without mutating the input.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { authorityFor, isDomainOwned, isTrackerOwned, splitFieldsByAuthority, AUTHORITY } from '../../lib/tracker-projection/field-authority.mjs';
import { buildProjection, projectionId, canonicalJson, valuesEqual, projectionFieldsByAuthority } from '../../lib/tracker-projection/projection.mjs';

function sampleIssue(overrides = {}) {
  return {
    id: 'construct-b0nny.27',
    title: 'Build Beads tracker projection',
    description: '## Objective\nMake bd a projection',
    status: 'in_progress',
    priority: 2,
    issue_type: 'task',
    assignee: 'Gerald Dagher',
    owner: 'someone@example.com',
    labels: ['execution-program'],
    created_at: '2026-07-17T21:20:35Z',
    updated_at: '2026-07-18T00:00:00Z',
    dependencies: [{ issue_id: 'construct-b0nny.27', depends_on_id: 'construct-b0nny.23', type: 'blocks' }],
    dependency_count: 1,
    comment_count: 0,
    parent: 'construct-b0nny',
    ...overrides,
  };
}

test('authorityFor classifies live operational fields as tracker-owned', () => {
  for (const field of ['status', 'assignee', 'owner', 'priority', 'labels', 'created_at', 'updated_at', 'closed_at', 'close_reason']) {
    assert.equal(authorityFor(field), AUTHORITY.TRACKER, `${field} is bd-owned`);
    assert.equal(isTrackerOwned(field), true);
  }
});

test('authorityFor classifies dependency edges and the Work-spec what/why as domain-owned', () => {
  for (const field of ['dependencies', 'parent', 'title', 'description', 'issue_type']) {
    assert.equal(authorityFor(field), AUTHORITY.DOMAIN, `${field} is projected from E1/E3`);
    assert.equal(isDomainOwned(field), true);
  }
});

test('authorityFor defaults an unknown bd field to tracker-owned', () => {
  assert.equal(authorityFor('some_future_bd_field'), AUTHORITY.TRACKER);
});

test('splitFieldsByAuthority omits identity and buckets the rest', () => {
  const { domain, tracker } = splitFieldsByAuthority(sampleIssue());
  assert.ok(domain.includes('dependencies') && domain.includes('title'));
  assert.ok(tracker.includes('status') && tracker.includes('priority'));
  assert.ok(!domain.includes('id') && !tracker.includes('id'), 'id is identity, in neither bucket');
});

test('projectionId is stable and prefixed', () => {
  assert.equal(projectionId('construct-b0nny.27'), 'beads:construct-b0nny.27');
});

test('buildProjection preserves the entire issue verbatim in raw_record', () => {
  const issue = sampleIssue();
  const projection = buildProjection(issue, { workspace: 'ws1' });
  assert.equal(canonicalJson(projection.raw_record), canonicalJson(issue), 'raw_record is a verbatim copy');
  assert.deepEqual(projection.raw_record, issue);
});

test('buildProjection raw_record is an independent deep clone (no aliasing)', () => {
  const issue = sampleIssue();
  const projection = buildProjection(issue);
  projection.raw_record.dependencies[0].type = 'MUTATED';
  assert.equal(issue.dependencies[0].type, 'blocks', 'mutating the clone does not touch the source issue');
});

test('buildProjection records per-field authority and initial lifecycle state', () => {
  const projection = buildProjection(sampleIssue(), { workspace: 'ws1', workId: 'work-42' });
  assert.equal(projection.tracker, 'beads');
  assert.equal(projection.external_id, 'construct-b0nny.27');
  assert.equal(projection.workspace, 'ws1');
  assert.equal(projection.work, 'work-42');
  assert.equal(projection.state, 'projected');
  assert.equal(projection.field_authority.status, AUTHORITY.TRACKER);
  assert.equal(projection.field_authority.dependencies, AUTHORITY.DOMAIN);
  assert.equal(projection.fields.title, 'Build Beads tracker projection');
});

test('buildProjection does not carry id into the fields snapshot', () => {
  const projection = buildProjection(sampleIssue());
  assert.ok(!('id' in projection.fields), 'identity is not a diffable field');
});

test('buildProjection rejects an issue with no string id', () => {
  assert.throws(() => buildProjection({ title: 'no id' }), /string id/);
  assert.throws(() => buildProjection(null), /object with a string id/);
});

test('projectionFieldsByAuthority reflects the recorded authority map', () => {
  const { domain, tracker } = projectionFieldsByAuthority(buildProjection(sampleIssue()));
  assert.ok(domain.includes('title') && domain.includes('dependencies'));
  assert.ok(tracker.includes('status') && tracker.includes('labels'));
});

test('canonicalJson/valuesEqual are key-order-independent', () => {
  assert.equal(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(valuesEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(valuesEqual([1, 2], [1, 2]), true);
});
