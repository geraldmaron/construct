/**
 * tests/kernel/context/produce.test.ts — the screen between a producer's
 * reply and the loop.
 *
 * The properties held here: well-formed items pass untouched, malformed items
 * are returned as reasons rather than swallowed, a citation naming a
 * different note is malformed (not merely unresolved), an unstated risk is
 * high risk, and observations always carry the producing role while their
 * citation judgment is left to the observation screen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toProducedLoop } from '../../../src/kernel/context/produce.ts';

test('a well-formed reply passes through whole', () => {
  const loop = toProducedLoop(
    {
      deltas: [
        {
          kind: 'process',
          domain: 'product-scoping',
          body: 'this client decides scope by quarter',
          citation: 'note:n-1#L2',
          external: false,
        },
      ],
      proposals: [
        {
          source: 'src-1',
          change: 'move PROJ-14 to Q4',
          justification: 'note:n-1#L3',
          risk: 'low',
        },
      ],
      observations: [
        {
          claim: 'the PRD and the strategy disagree on SSO timing',
          citations: [
            { source: 'src-1', document: 'docs/prd.md' },
            { source: 'src-1', document: 'docs/strategy.md' },
          ],
        },
      ],
    },
    'n-1',
  );
  assert.equal(loop.deltas.length, 1);
  assert.equal(loop.proposals.length, 1);
  assert.equal(loop.observations.length, 1);
  assert.equal(loop.observations[0]?.role, 'context-producer');
  assert.deepEqual(loop.discarded, []);
});

test('malformed items become reasons, not silence', () => {
  const loop = toProducedLoop(
    {
      deltas: [
        { kind: 'hunch', domain: 'x', body: 'wrong kind', citation: 'note:n-1#L1' },
        { kind: 'process', domain: 'x', body: 'cites another note', citation: 'note:n-2#L1' },
        { kind: 'process', domain: 'x', body: 'cites nothing', citation: 'somewhere' },
        { kind: 'process', domain: '', body: 'no domain', citation: 'note:n-1#L1' },
      ],
      proposals: [
        { source: 'src-1', change: 'unjustified', justification: 'trust me', risk: 'low' },
        { source: '', change: 'no source', justification: 'note:n-1#L1', risk: 'low' },
      ],
      observations: [{ claim: '   ' }],
    },
    'n-1',
  );
  assert.equal(loop.deltas.length, 0);
  assert.equal(loop.proposals.length, 0);
  assert.equal(loop.observations.length, 0);
  assert.equal(loop.discarded.length, 7);
  assert.ok(loop.discarded.some((r) => /unknown kind/.test(r)));
  assert.ok(loop.discarded.some((r) => /does not name a line of note n-1/.test(r)));
});

test('an unstated or unrecognized risk is high risk', () => {
  const loop = toProducedLoop(
    {
      proposals: [
        { source: 'src-1', change: 'a', justification: 'note:n-1#L1' },
        { source: 'src-1', change: 'b', justification: 'note:n-1#L1', risk: 'medium' },
        { source: 'src-1', change: 'c', justification: 'note:n-1#L1', risk: 'low' },
      ],
    },
    'n-1',
  );
  assert.deepEqual(
    loop.proposals.map((p) => p.risk),
    ['high', 'high', 'low'],
  );
});

test('an empty or shapeless reply is three empty lists, not a failure', () => {
  const loop = toProducedLoop({}, 'n-1');
  assert.deepEqual(loop, { deltas: [], proposals: [], observations: [], discarded: [] });
  const fromNull = toProducedLoop(null, 'n-1');
  assert.equal(fromNull.deltas.length, 0);
});

test('an observation keeps its claim even when citations are malformed — the screen owns that judgment', () => {
  const loop = toProducedLoop(
    {
      observations: [
        { claim: 'real claim', citations: [{ source: 'src-1' }, 'garbage', { source: 's', document: 'd' }] },
      ],
    },
    'n-1',
  );
  assert.equal(loop.observations.length, 1);
  assert.deepEqual(loop.observations[0]?.citations, [{ source: 's', document: 'd' }]);
});
