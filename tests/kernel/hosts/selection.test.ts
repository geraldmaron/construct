/**
 * tests/kernel/hosts/selection.test.ts — the resource ladder decides from what
 * is actually present, prefers the cheapest thing that can do the job, and
 * leaves a reason for every resource it passed over.
 *
 * The cases that matter are the ones where a wrong answer is expensive or
 * silent: a metered resource chosen while a free one was sitting there, a
 * read-only host chosen for work that has to write, a below-floor run that
 * nobody was told about, and a refusal that says "no" without saying what it
 * looked for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseResource,
  costRank,
  explainSelection,
  needFor,
  selectionDetail,
} from '../../../src/kernel/hosts/selection.ts';
import type { Resource, WorkNeed } from '../../../src/kernel/hosts/selection.ts';

function resource(over: Partial<Resource> & { readonly host: string }): Resource {
  return {
    found: true,
    dispatchable: true,
    capabilities: ['interrupt', 'concurrent'],
    tier: null,
    costClass: 'unknown',
    costReason: `cost of ${over.host} was not measured`,
    presence: `${over.host}: found`,
    ...over,
  };
}

const anything: WorkNeed = { floor: 'any', capabilities: [], rerunnable: true };

test('cost classes are ordered cheapest first and unmeasured is ordered last', () => {
  assert.ok(costRank('local') < costRank('subscription'));
  assert.ok(costRank('subscription') < costRank('metered'));
  assert.ok(costRank('metered') < costRank('unknown'), 'an unmeasured price is never the cheap case');
});

test('the cheapest present resource that can do the job wins', () => {
  const selection = chooseResource(
    [
      resource({ host: 'metered-one', costClass: 'metered' }),
      resource({ host: 'free-one', costClass: 'local' }),
      resource({ host: 'paid-for', costClass: 'subscription' }),
    ],
    anything,
  );
  assert.equal(selection.rung, 'clears');
  assert.equal(selection.host, 'free-one');
  assert.equal(selection.costClass, 'local');
});

test('an unmeasured price loses to a subscription that is already paid for', () => {
  const selection = chooseResource(
    [
      resource({ host: 'unmeasured', costClass: 'unknown' }),
      resource({ host: 'paid-for', costClass: 'subscription' }),
    ],
    anything,
  );
  assert.equal(selection.host, 'paid-for');
  const passedOver = selection.rejected.find((r) => r.host === 'unmeasured');
  assert.match(passedOver?.why ?? '', /costs more than paid-for/);
});

test('a tie on cost is broken by the order the census declared, so nothing is arbitrary', () => {
  const census = [
    resource({ host: 'first', costClass: 'subscription' }),
    resource({ host: 'second', costClass: 'subscription' }),
  ];
  assert.equal(chooseResource(census, anything).host, 'first');
  assert.equal(chooseResource([...census].reverse(), anything).host, 'second');
  const why = chooseResource(census, anything).rejected.find((r) => r.host === 'second')?.why;
  assert.match(why ?? '', /same cost class/);
});

test('a resource that cannot write outward is not chosen for work that writes outward', () => {
  const selection = chooseResource(
    [
      resource({ host: 'read-only', costClass: 'local', capabilities: ['interrupt'] }),
      resource({ host: 'can-write', costClass: 'metered', capabilities: ['interrupt', 'outward-write'] }),
    ],
    { floor: 'any', capabilities: ['outward-write'], rerunnable: false },
  );
  assert.equal(selection.host, 'can-write', 'the cheap one cannot do the job, so it does not win');
  const refusedRung = selection.rejected.find((r) => r.host === 'read-only');
  assert.match(refusedRung?.why ?? '', /does not carry outward-write/);
});

test('a missing binary is rejected as not found, and a host with no adapter says that instead', () => {
  const selection = chooseResource(
    [
      resource({ host: 'absent', found: false, dispatchable: false }),
      resource({ host: 'no-adapter', found: true, dispatchable: false }),
      resource({ host: 'usable', costClass: 'local' }),
    ],
    anything,
  );
  assert.equal(selection.host, 'usable');
  assert.match(selection.rejected.find((r) => r.host === 'absent')?.why ?? '', /not found on this machine/);
  assert.match(selection.rejected.find((r) => r.host === 'no-adapter')?.why ?? '', /no adapter/);
});

test('every resource that did not carry the work is named with its own reason', () => {
  const selection = chooseResource(
    [
      resource({ host: 'absent', found: false, dispatchable: false }),
      resource({ host: 'read-only', capabilities: ['interrupt'] }),
      resource({ host: 'pricey', costClass: 'metered', capabilities: ['interrupt', 'outward-write'] }),
      resource({ host: 'chosen', costClass: 'local', capabilities: ['interrupt', 'outward-write'] }),
    ],
    { floor: 'any', capabilities: ['outward-write'], rerunnable: true },
  );
  assert.equal(selection.host, 'chosen');
  assert.deepEqual(
    selection.rejected.map((r) => r.host).sort(),
    ['absent', 'pricey', 'read-only'],
    'an audit of the choice can see all three',
  );
  for (const rejected of selection.rejected) {
    assert.ok(rejected.why.length > 0, `${rejected.host} was rejected without a reason`);
  }
});

test('nothing present at all is a refusal that names what it was looking for', () => {
  const selection = chooseResource(
    [
      resource({ host: 'absent', found: false, dispatchable: false }),
      resource({ host: 'also-absent', found: false, dispatchable: false }),
    ],
    { floor: 'capable', capabilities: ['outward-write'], rerunnable: true },
  );
  assert.equal(selection.rung, 'refused');
  assert.equal(selection.host, null);
  assert.match(selection.reason, /outward-write/);
  const lines = explainSelection(selection, {
    floor: 'capable',
    capabilities: ['outward-write'],
    rerunnable: true,
  });
  assert.ok(lines.some((l) => /needed: model floor "capable"; capability outward-write/.test(l)));
  assert.ok(lines.some((l) => /found: absent \(not found on this machine\)/.test(l)));
});

test('re-runnable work below every present floor runs, and carries the degradation note', () => {
  const selection = chooseResource(
    [resource({ host: 'small', costClass: 'local', tier: 'any' })],
    { floor: 'frontier', capabilities: [], rerunnable: true },
  );
  assert.equal(selection.rung, 'degraded');
  assert.equal(selection.host, 'small');
  assert.match(selection.degradation ?? '', /nothing present clears the "frontier" floor/);
  assert.match(selection.degradation ?? '', /runs at tier "any"/);
  assert.ok(
    explainSelection(selection, { floor: 'frontier', capabilities: [], rerunnable: true }).some((l) =>
      /⚑/.test(l),
    ),
    'the degradation is not buried in the record only',
  );
});

test('a host that will not say what tier it runs does not silently satisfy a floor', () => {
  const selection = chooseResource([resource({ host: 'silent', costClass: 'local', tier: null })], {
    floor: 'capable',
    capabilities: [],
    rerunnable: true,
  });
  assert.equal(selection.rung, 'degraded');
  assert.match(selection.degradation ?? '', /would not say what tier it runs/);
});

test('work that writes outward is not put below its floor on the user\'s behalf', () => {
  const selection = chooseResource(
    [resource({ host: 'small', costClass: 'local', tier: 'any', capabilities: ['outward-write'] })],
    { floor: 'frontier', capabilities: ['outward-write'], rerunnable: false },
  );
  assert.equal(selection.rung, 'refused', 'a write that cannot be un-run is not degraded quietly');
  assert.match(selection.reason, /cannot be run below the floor and run again/);
  assert.match(selection.rejected.find((r) => r.host === 'small')?.why ?? '', /below the "frontier" floor/);
});

test('a resource that clears the floor beats a cheaper one that does not', () => {
  const selection = chooseResource(
    [
      resource({ host: 'free-but-weak', costClass: 'local', tier: 'any' }),
      resource({ host: 'paid-and-strong', costClass: 'metered', tier: 'frontier' }),
    ],
    { floor: 'frontier', capabilities: [], rerunnable: true },
  );
  assert.equal(selection.rung, 'clears');
  assert.equal(selection.host, 'paid-and-strong');
});

test('the strongest floor any brief declared is the floor the run is held to', () => {
  const need = needFor([
    { modelFloor: 'any', capabilities: [] },
    { modelFloor: 'frontier', capabilities: [] },
    { modelFloor: 'capable', capabilities: [] },
  ]);
  assert.equal(need.floor, 'frontier');
});

test('a brief declaring no floor gets none rather than a guessed one', () => {
  assert.equal(needFor([{ capabilities: [] }, {}]).floor, 'any');
});

test('tool capabilities stay the dispatcher\'s business; only host capabilities reach selection', () => {
  const need = needFor([{ capabilities: ['outward-write', 'read-the-web', 'sandbox'] }]);
  assert.deepEqual([...need.capabilities].sort(), ['outward-write', 'sandbox']);
  assert.equal(need.rerunnable, false, 'writing outward is what makes a run one-shot');
});

test('work that writes nothing outward is re-runnable', () => {
  assert.equal(needFor([{ capabilities: ['interrupt'] }]).rerunnable, true);
  assert.equal(needFor([]).rerunnable, true);
});

test('a task stored with no brief contributes nothing instead of a guess', () => {
  const need = needFor([null, undefined, 'not a brief', 42, { modelFloor: 'nonsense', capabilities: 'no' }]);
  assert.equal(need.floor, 'any');
  assert.deepEqual(need.capabilities, []);
});

test('the recorded detail carries the rung, the choice, the cost, and every rejection', () => {
  const need: WorkNeed = { floor: 'capable', capabilities: [], rerunnable: true };
  const selection = chooseResource(
    [
      resource({ host: 'cheap', costClass: 'local', tier: 'any' }),
      resource({ host: 'strong', costClass: 'subscription', tier: 'frontier' }),
    ],
    need,
  );
  const detail = selectionDetail(selection, need);
  assert.equal(detail.rung, 'clears');
  assert.equal(detail.host, 'strong');
  assert.equal(detail.costClass, 'subscription');
  assert.equal(detail.floor, 'capable');
  assert.equal(detail.rerunnable, true);
  assert.ok(typeof detail.reason === 'string' && detail.reason.length > 0);
  assert.deepEqual((detail.rejected as { host: string }[]).map((r) => r.host), ['cheap']);
  assert.equal(detail.degradation, undefined, 'a choice that cleared its floor carries no degradation');
});
