/**
 * tests/kernel/tracker/projection.test.ts — behavior lock for the tracker
 * projection harvest. fixtures/tracker-golden.json is v2's own output, captured
 * by scripts/capture-legacy-tracker-golden.mjs with `importedAt` pinned.
 *
 * The properties that matter here are zero-loss import (nothing a tracker sends
 * is dropped, including fields this model has never heard of) and correct
 * authority assignment (whoever does not own a field must never overwrite it).
 * Both are asserted directly, not just via the corpus.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTHORITY,
  FIELD_AUTHORITY,
  IDENTITY_FIELDS,
  authorityFor,
  splitFieldsByAuthority,
} from '../../../src/kernel/tracker/authority.ts';
import {
  buildProjection,
  canonicalJson,
  projectionFieldsByAuthority,
  projectionId,
  valuesEqual,
} from '../../../src/kernel/tracker/projection.ts';

interface Attempt {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly message?: string;
}

interface Golden {
  readonly fieldAuthority: Record<string, string>;
  readonly authorityFor: Record<string, string>;
  readonly canonical: { name: string; value: unknown; json: string }[];
  readonly equality: { name: string; a: unknown; b: unknown; equal: boolean }[];
  readonly ids: { externalId: string; projectionId: string }[];
  readonly projections: { name: string; issue: unknown; outcome: Attempt; split: Attempt }[];
  readonly byAuthority: { name: string; outcome: Attempt }[];
  readonly pinnedAt: string;
}

const GOLDEN: Golden = JSON.parse(
  readFileSync(new URL('./fixtures/tracker-golden.json', import.meta.url), 'utf8'),
);

function attempt(fn: () => unknown): Attempt {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test('the field-authority map is unchanged', () => {
  assert.deepEqual(plain(FIELD_AUTHORITY), GOLDEN.fieldAuthority);
});

test('authority resolution matches v2, including the unmapped default', () => {
  for (const [field, expected] of Object.entries(GOLDEN.authorityFor)) {
    assert.equal(authorityFor(field), expected, field);
  }
  assert.equal(
    authorityFor('totally_unknown_field'),
    AUTHORITY.TRACKER,
    'an unknown field must default to tracker-owned — see the module note',
  );
});

for (const c of GOLDEN.canonical) {
  test(`canonicalJson matches v2 — ${c.name}`, () => {
    assert.equal(canonicalJson(c.value), c.json);
  });
}

for (const c of GOLDEN.equality) {
  test(`valuesEqual matches v2 — ${c.name}`, () => {
    assert.equal(valuesEqual(c.a, c.b), c.equal);
  });
}

for (const c of GOLDEN.ids) {
  test(`projectionId matches v2 — ${c.externalId}`, () => {
    assert.equal(projectionId(c.externalId), c.projectionId);
  });
}

for (const c of GOLDEN.projections) {
  test(`buildProjection matches v2 — ${c.name}`, () => {
    const actual = attempt(() => buildProjection(c.issue, { importedAt: GOLDEN.pinnedAt }));
    assert.equal(actual.ok, c.outcome.ok);
    if (!c.outcome.ok) {
      assert.equal(actual.message, c.outcome.message, 'the stated reason must match too');
      return;
    }
    // v2's capture passed workspace/workId per case; re-apply them here so the
    // comparison covers those fields rather than skipping them.
    const expected = c.outcome.value as Record<string, unknown>;
    const withOptions = buildProjection(c.issue, {
      importedAt: GOLDEN.pinnedAt,
      workspace: expected.workspace as string | null,
      workId: expected.work as string | null,
    });
    assert.deepEqual(plain(withOptions), expected);
  });

  test(`splitFieldsByAuthority matches v2 — ${c.name}`, () => {
    assert.deepEqual(plain(attempt(() => splitFieldsByAuthority(c.issue))), c.split);
  });
}

for (const c of GOLDEN.byAuthority) {
  test(`projectionFieldsByAuthority matches v2 — ${c.name}`, () => {
    const source = GOLDEN.projections.find((p) => p.name === c.name)!;
    const actual = attempt(() => {
      const p = buildProjection(source.issue, { importedAt: GOLDEN.pinnedAt });
      return projectionFieldsByAuthority(p);
    });
    assert.equal(actual.ok, c.outcome.ok);
    if (actual.ok) assert.deepEqual(plain(actual.value), c.outcome.value);
  });
}

test('import is zero-loss — every field survives verbatim in raw_record', () => {
  const issue = {
    id: 'z-1',
    title: 'kept',
    status: 'open',
    a_field_this_model_has_never_heard_of: { nested: [1, { deep: true }] },
    another: null,
    zero: 0,
    empty: '',
  };
  const p = buildProjection(issue, { importedAt: GOLDEN.pinnedAt });
  assert.deepEqual(p.raw_record, issue, 'raw_record must be the whole original');
  for (const key of Object.keys(issue)) {
    if (IDENTITY_FIELDS.includes(key)) continue;
    assert.ok(key in p.fields, `${key} must be snapshotted into fields`);
    assert.ok(key in p.field_authority, `${key} must get an authority`);
  }
});

test('raw_record is a clone — mutating the source issue cannot corrupt the audit copy', () => {
  const issue: Record<string, unknown> = { id: 'm-1', labels: ['a'] };
  const p = buildProjection(issue, { importedAt: GOLDEN.pinnedAt });
  (issue.labels as string[]).push('b');
  issue.title = 'added later';
  assert.deepEqual((p.raw_record as { labels: string[] }).labels, ['a']);
  assert.equal('title' in (p.raw_record as object), false);
  assert.deepEqual((p.fields.labels as string[]), ['a']);
});

test('fields and raw_record do not alias each other', () => {
  const p = buildProjection({ id: 'a-1', labels: ['a'] }, { importedAt: GOLDEN.pinnedAt });
  (p.fields.labels as string[]).push('mutated');
  assert.deepEqual((p.raw_record as { labels: string[] }).labels, ['a'], 'the audit copy must be untouched');
});

test('the kernel never reads the clock — importedAt defaults to null', () => {
  const p = buildProjection({ id: 'c-1' });
  assert.equal(p.importedAt, null);
  assert.equal(p.reconciledAt, null);
  // The consequence that makes this worth doing: two identical imports compare
  // equal, which v2's new Date() default made impossible.
  assert.deepEqual(buildProjection({ id: 'c-1' }), buildProjection({ id: 'c-1' }));
});

test('a projection id is stable across re-imports', () => {
  const first = buildProjection({ id: 'r-1', status: 'open' }, { importedAt: GOLDEN.pinnedAt });
  const second = buildProjection({ id: 'r-1', status: 'closed' }, { importedAt: GOLDEN.pinnedAt });
  assert.equal(first.id, second.id, 'a re-import must update, not duplicate');
});

test('every domain-owned field is one Construct can actually author', () => {
  // A field Construct does not produce must never be marked domain-owned, or
  // reconciliation would overwrite real tracker data with nothing.
  const domainFields = Object.entries(FIELD_AUTHORITY)
    .filter(([, a]) => a === AUTHORITY.DOMAIN)
    .map(([f]) => f);
  assert.deepEqual(domainFields.sort(), [
    'dependencies',
    'description',
    'issue_type',
    'parent',
    'title',
  ]);
});
