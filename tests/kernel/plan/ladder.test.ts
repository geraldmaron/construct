/**
 * tests/kernel/plan/ladder.test.ts — an empty required slot is a
 * machine-checkable gap, the ladder climbs in its stated order, and asking
 * the human batches to the inbox with an assumed default so nothing blocks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { openDecisions } from '../../../src/kernel/store/decisions.ts';
import { batchAskHuman, nextRung, slotGaps } from '../../../src/kernel/plan/ladder.ts';
import { playbookFor } from '../../../src/kernel/plan/playbooks.ts';

const AT = '2026-08-05T00:00:00.000Z';

test('an empty or whitespace required slot is a gap; optional slots never are', () => {
  const template = playbookFor('security').template;
  const gaps = slotGaps(template, {
    finding: 'exposed webhook lacks auth',
    evidence: '  ',
    // risks, attack-surface, mitigations missing; open-questions is optional
  });
  const names = gaps.map((g) => g.slot.name);
  assert.deepEqual(names, ['evidence', 'risks', 'attack-surface', 'mitigations']);
  assert.ok(!names.includes('open-questions'));
});

test('a fully filled template has no gaps', () => {
  const template = playbookFor('unknown-domain').template;
  const filled = Object.fromEntries(template.slots.map((s) => [s.name, 'content']));
  assert.deepEqual(slotGaps(template, filled), []);
});

test('the ladder climbs read-sources, research, ask-human, assume-and-label, then ends', () => {
  assert.equal(nextRung([]), 'read-sources');
  assert.equal(nextRung(['read-sources']), 'research');
  assert.equal(nextRung(['read-sources', 'research']), 'ask-human');
  assert.equal(nextRung(['read-sources', 'research', 'ask-human']), 'assume-and-label');
  assert.equal(nextRung(['read-sources', 'research', 'ask-human', 'assume-and-label']), null);
});

test('ask-human batches to the inbox, each question carrying its assumed default', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    const gap = slotGaps(playbookFor('security').template, {})[0]!;
    const ids = batchAskHuman(
      store,
      'run-1',
      'plan-run-1',
      [
        { gap, assumedDefault: 'no finding yet; treat as unassessed', basis: 'plan-run-1' },
        { gap, assumedDefault: 'assume public exposure', basis: 'plan-run-1' },
      ],
      AT,
    );
    assert.equal(ids.length, 2);
    const open = openDecisions(store, 'run-1');
    assert.equal(open.length, 2);
    const positions = open[0]!.positions;
    assert.equal(positions.length, 2);
    assert.equal(positions[1]?.role, 'assumed-default');
    assert.equal(positions[1]?.stance, 'no finding yet; treat as unassessed');
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('a question with no assumed default is refused: that is a stall in disguise', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    const gap = slotGaps(playbookFor('security').template, {})[0]!;
    assert.throws(
      () => batchAskHuman(store, 'run-1', 'plan-run-1', [{ gap, assumedDefault: '  ', basis: 'x' }], AT),
      /ships no assumed default/,
    );
    assert.equal(openDecisions(store, 'run-1').length, 0);
  } finally {
    store.close();
    fixture.cleanup();
  }
});
