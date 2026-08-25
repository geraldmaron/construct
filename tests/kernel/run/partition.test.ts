/**
 * tests/kernel/run/partition.test.ts — which sources reach which dispatch.
 *
 * The claim being pinned is narrow and worth stating plainly: material moves
 * only where a user's own declared relationship says it should. So the first
 * test is the one that would catch this module inventing a division of its own
 * — with nothing declared, every dispatch still gets everything — and each of
 * the six relationship words is then checked for the behaviour that makes it
 * worth shipping.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionMaterial } from '../../../src/kernel/run/partition.ts';
import type { Material } from '../../../src/kernel/run/grounding.ts';
import type { SourceEdge, SourceRelation } from '../../../src/kernel/store/source-edges.ts';

const AT = '2026-08-25T00:00:00.000Z';

function material(...sources: readonly string[]): Material[] {
  return sources.map((source) => ({
    source,
    descriptor: `${source}/doc.md`,
    coverage: 'complete' as const,
    detail: '1 of 1 documents',
  }));
}

function edge(from: string, relation: SourceRelation, to: string): SourceEdge {
  return {
    id: `rel-${from}-${relation}-${to}`,
    workspace: 'ops',
    from,
    to,
    relation,
    note: '',
    declaredAt: AT,
    retiredAt: null,
  };
}

/** The sources reaching each dispatch, in a shape a failure reads plainly. */
function reaching(
  input: Parameters<typeof partitionMaterial>[0],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [dispatch, held] of partitionMaterial(input)) {
    out[dispatch] = held.map((item) => item.source);
  }
  return out;
}

test('with nothing declared, every dispatch gets every source', () => {
  assert.deepEqual(
    reaching({ material: material('a', 'b', 'c'), edges: [], dispatches: ['t1', 't2'] }),
    { t1: ['a', 'b', 'c'], t2: ['a', 'b', 'c'] },
  );
});

test('a relationship reaching material the run never read moves nothing', () => {
  assert.deepEqual(
    reaching({
      material: material('a', 'b'),
      edges: [edge('a', 'covers-same-initiative', 'z')],
      dispatches: ['t1', 't2'],
    }),
    { t1: ['a', 'b'], t2: ['a', 'b'] },
  );
});

test('sources covering the same initiative are split across dispatches', () => {
  assert.deepEqual(
    reaching({
      material: material('a', 'b'),
      edges: [edge('a', 'covers-same-initiative', 'b')],
      dispatches: ['t1', 't2'],
    }),
    { t1: ['a'], t2: ['b'] },
  );
});

test('a rule and what it governs are never split apart, whatever else is', () => {
  // `a` governs `b`, and `c` covers the same initiative as `a`. So the split is
  // between the pair and `c`, never through the middle of the pair.
  assert.deepEqual(
    reaching({
      material: material('a', 'b', 'c'),
      edges: [edge('a', 'governs', 'b'), edge('a', 'covers-same-initiative', 'c')],
      dispatches: ['t1', 't2'],
    }),
    { t1: ['a', 'b'], t2: ['c'] },
  );
});

test('what feeds, what depends, and what contradicts travel with their other end', () => {
  for (const relation of ['feeds', 'depends-on', 'contradicts'] as const) {
    assert.deepEqual(
      reaching({
        material: material('a', 'b', 'c'),
        edges: [edge('a', relation, 'b'), edge('a', 'covers-same-initiative', 'c')],
        dispatches: ['t1', 't2'],
      }),
      { t1: ['a', 'b'], t2: ['c'] },
      relation,
    );
  }
});

test('a superseded source does not travel with what supersedes it, and is not deleted either', () => {
  assert.deepEqual(
    reaching({
      material: material('new', 'old', 'other'),
      edges: [edge('new', 'supersedes', 'old')],
      dispatches: ['t1', 't2'],
    }),
    { t1: ['new', 'other'], t2: ['old', 'other'] },
  );
});

test('a superseded source still reaches a dispatch its replacement did not', () => {
  assert.deepEqual(
    reaching({
      material: material('new', 'old'),
      edges: [edge('new', 'supersedes', 'old'), edge('new', 'covers-same-initiative', 'old')],
      dispatches: ['t1', 't2'],
    }),
    { t1: ['new'], t2: ['old'] },
  );
});

test('one dispatch holds the whole ground, minus what was replaced', () => {
  assert.deepEqual(
    reaching({
      material: material('a', 'b', 'old'),
      edges: [edge('a', 'covers-same-initiative', 'b'), edge('a', 'supersedes', 'old')],
      dispatches: ['t1'],
    }),
    { t1: ['a', 'b'] },
  );
});

test('a dispatch the division leaves empty is given the whole ground, not nothing', () => {
  const split = reaching({
    material: material('a', 'b'),
    edges: [edge('a', 'covers-same-initiative', 'b')],
    dispatches: ['t1', 't2', 't3'],
  });
  assert.deepEqual(split.t1, ['a']);
  assert.deepEqual(split.t2, ['b']);
  assert.deepEqual(
    split.t3,
    ['a', 'b'],
    'a role with no material reasons from its domain alone while the run\'s ground sits unread',
  );
});

test('naming no dispatch partitions nothing', () => {
  assert.deepEqual(reaching({ material: material('a'), edges: [], dispatches: [] }), {});
});

test('a retired relationship divides nothing', () => {
  assert.deepEqual(
    reaching({
      material: material('a', 'b'),
      edges: [{ ...edge('a', 'covers-same-initiative', 'b'), retiredAt: AT }],
      dispatches: ['t1', 't2'],
    }),
    { t1: ['a', 'b'], t2: ['a', 'b'] },
  );
});

test('the same run partitions the same way every time it is asked', () => {
  const input = {
    material: material('a', 'b', 'c', 'd'),
    edges: [edge('a', 'covers-same-initiative', 'b'), edge('c', 'feeds', 'a')],
    dispatches: ['t1', 't2'],
  };
  assert.deepEqual(reaching(input), reaching(input));
});

/**
 * Two relationship words landing on one source is where a division stops being
 * three independent rules and becomes an interaction. The property that has to
 * hold across all of them is one sentence: a source the run read and paid to
 * survey reaches somebody, unless the user's own statement says the only place
 * it could go already holds what replaced it.
 */
function everythingLandsSomewhere(input: Parameters<typeof partitionMaterial>[0]): void {
  const held = reaching(input);
  const anywhere = new Set(Object.values(held).flat());
  for (const item of input.material) {
    if (anywhere.has(item.source)) continue;
    // The one legal absence: every dispatch holds something declared to
    // supersede it.
    const replacements = input.edges
      .filter((edge) => edge.relation === 'supersedes' && edge.to === item.source)
      .map((edge) => edge.from);
    assert.ok(replacements.length > 0, `${item.source} reached no dispatch and nothing replaced it`);
    for (const [dispatch, sources] of Object.entries(held)) {
      assert.ok(
        replacements.some((replacement) => sources.includes(replacement)),
        `${item.source} was withheld from ${dispatch}, which holds none of its replacements`,
      );
    }
  }
}

test('a replaced source whose alternate was split away still lands somewhere', () => {
  // The interaction that used to lose material outright: `a` supersedes `b`,
  // and `b` covers the same initiative as `c`. Splitting b from c put b in a
  // dispatch that also held a, a stripped it, and b reached nobody at all.
  const input = {
    material: material('a', 'b', 'c'),
    edges: [edge('a', 'supersedes', 'b'), edge('b', 'covers-same-initiative', 'c')],
    dispatches: ['t1', 't2'],
  };
  const held = reaching(input);
  everythingLandsSomewhere(input);
  assert.deepEqual(held, { t1: ['a', 'c'], t2: ['b'] });
  assert.ok(!held.t2.includes('a'), 'and the replaced version is still never read beside its replacement');
});

test('a source that both governs and is superseded keeps the rule it cannot be read without', () => {
  const input = {
    material: material('rule', 'held', 'newer'),
    edges: [edge('rule', 'governs', 'held'), edge('newer', 'supersedes', 'held')],
    dispatches: ['t1', 't2'],
  };
  const held = reaching(input);
  everythingLandsSomewhere(input);
  for (const sources of Object.values(held)) {
    if (sources.includes('held')) {
      assert.ok(sources.includes('rule'), 'what governs it travels with it');
      assert.ok(!sources.includes('newer'), 'what replaced it does not');
    }
  }
});

test('a chain of replacements loses none of its links', () => {
  const input = {
    material: material('v3', 'v2', 'v1'),
    edges: [edge('v3', 'supersedes', 'v2'), edge('v2', 'supersedes', 'v1')],
    dispatches: ['t1', 't2', 't3'],
  };
  everythingLandsSomewhere(input);
  const held = reaching(input);
  for (const sources of Object.values(held)) {
    assert.ok(!(sources.includes('v3') && sources.includes('v2')), 'v2 is never read beside v3');
    assert.ok(!(sources.includes('v2') && sources.includes('v1')), 'v1 is never read beside v2');
  }
});

test('two sources replacing the same third one do not between them erase it', () => {
  const input = {
    material: material('a', 'b', 'old', 'other'),
    edges: [edge('a', 'supersedes', 'old'), edge('b', 'supersedes', 'old')],
    dispatches: ['t1', 't2', 't3'],
  };
  everythingLandsSomewhere(input);
});

test('inseparable and replaced at once is the one absence the user themselves declared', () => {
  // `a` governs `b` and also supersedes it — two statements that cannot both be
  // acted on. Rule 1 binds them into one dispatch, rule 3 strips the replaced
  // one there, and rule 4 finds nowhere legal to put it back. The absence is
  // the contradiction being honoured, not material going quietly missing.
  const input = {
    material: material('a', 'b'),
    edges: [edge('a', 'governs', 'b'), edge('a', 'supersedes', 'b')],
    dispatches: ['t1', 't2'],
  };
  everythingLandsSomewhere(input);
  assert.deepEqual(reaching(input), { t1: ['a'], t2: ['a'] });
});

test('a superseded source whose replacement covers a third initiative still lands', () => {
  const input = {
    material: material('plan', 'old', 'side'),
    edges: [edge('plan', 'supersedes', 'old'), edge('plan', 'covers-same-initiative', 'side')],
    dispatches: ['t1', 't2'],
  };
  everythingLandsSomewhere(input);
});
