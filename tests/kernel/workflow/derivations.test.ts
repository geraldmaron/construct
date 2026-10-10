import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runValidators } from '../../../src/kernel/workflow/validators.ts';

const check = (derivations: unknown[], summary = 'The total is 156.', source = 'Inputs are 12, 15 and 24.') => runValidators(['numbers_grounded'], {
  output: { summary, derivations }, expectedKeys: [], evidence: [{ ref: 'source' }], resolvableRefs: new Set(),
  resolve: ref => ref === 'source' ? { ref, kind: 'item', provenance: 'witnessed', text: source } : null,
})[0]!;

test('intermediate arithmetic is grounded from cited inputs independent of declaration order', () => {
  const a = { value: 180, expression: '12 * 15' }, b = { value: 156, expression: '180 - 24' }, c = { value: 13, expression: '156 / 12' };
  for (const ds of [[a, b, c], [c, b, a], [b, a, c], [c, a, b]]) assert.equal(check(ds, 'The results are 180, 156 and 13.').ok, true);
});

test('equivalent numeric spellings share an intermediate without using output as its own source', () => {
  assert.equal(check([{ value: '1.8k', expression: '120 * 15' }, { value: 1776, expression: '1800 - 24' }], 'Total 1776.', 'Inputs are 120, 15 and 24.').ok, true);
  assert.equal(check([{ value: 156, expression: '180 - 24' }], 'An asserted intermediate is 180. Total 156.').ok, false);
});

test('unsupported cycles, self references and invalid intermediates never establish numeric support', () => {
  for (const ds of [
    [{ value: 180, expression: '204 - 24' }, { value: 204, expression: '180 + 24' }, { value: 156, expression: '180 - 24' }],
    [{ value: 180, expression: '180' }, { value: 156, expression: '180 - 24' }],
    [{ value: 180, expression: '12 * 12' }, { value: 156, expression: '180 - 24' }],
    [{ value: 180, expression: '90 * 2' }, { value: 156, expression: '180 - 24' }],
  ]) {
    const result = check(ds);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some(p => p.includes('180') || p.includes('90')));
  }
});

test('a malformed or contradictory calculation fails even beside a valid chain', () => {
  const chain = [{ value: 180, expression: '12 * 15' }, { value: 156, expression: '180 - 24' }];
  for (const extra of [{ value: 'not-a-number', expression: '12 * 15' }, { value: 180, expression: '12 * 12' }, { value: 156 }, { value: 156, expression: 'execute()' }]) assert.equal(check([...chain, extra]).ok, false);
});

test('renamed quantitative domains retain chained evidence without admitting arbitrary reported figures', () => {
  for (const [x, y, z] of [[11, 17, 23], [18, 14, 29], [21, 16, 37]]) {
    const intermediate = x! * y!, result = intermediate - z!;
    const derivations = [{ value: result, expression: `${intermediate} - ${z}` }, { value: intermediate, expression: `${x} * ${y}` }];
    assert.equal(check(derivations, `Requested total ${result}.`, `Observed operands ${x}, ${y}, ${z}.`).ok, true);
    assert.equal(check(derivations, `Requested total ${result}.`, `Observed operand ${z} only.`).ok, false);
  }
});

test('arithmetic tokens cannot disappear through prose date, unary, year or spacing rules', () => {
  for (const derivations of [
    [{ value: 180, expression: '204-24' }, { value: 156, expression: '180 - 24' }],
    [{ value: 180, expression: '204-24' }, { value: 204, expression: '180+24' }, { value: 156, expression: '180-24' }],
    [{ value: 180, expression: '-180 * -1' }, { value: 156, expression: '180-24' }],
    [{ value: 4, expression: '72/18' }, { value: 96, expression: '4 * 24' }],
    [{ value: 1000, expression: '2000/2' }, { value: 24000, expression: '1000 * 24' }],
  ]) assert.equal(check(derivations, 'Proposed values.', 'Only 24 is observed.').ok, false);
  assert.equal(check([{ value: 36, expression: '6*6' }, { value: 32, expression: '36-4' }], 'Net 32.', 'Count: 6. Conversion: 6. Reserved: 4.').ok, true);
  assert.equal(check([{ value: 180, expression: '15*12' }, { value: 156, expression: '180-24' }]).ok, true);
});

test('overflow and non-finite intermediates cannot seed any arithmetic chain', () => {
  const huge = '9'.repeat(310);
  for (const derivations of [
    [{ value: huge, expression: '12 * 12' }, { value: 156, expression: `${huge}/${huge}` }],
    [{ value: 180, expression: `${huge}*${huge}` }, { value: 156, expression: '180-24' }],
    [{ value: 180, expression: `${huge}-${huge}+180` }, { value: 156, expression: '180-24' }],
  ]) assert.equal(check(derivations).ok, false);
});

test('cited small literals may ground arithmetic while dates and identifier digits do not', () => {
  assert.equal(check([{ value: 55, expression: '5*11' }], 'Total 55.', 'Count 5 and factor 11.').ok, true);
  assert.equal(check([{ value: 55, expression: '5*11' }], 'Total 55.', 'Ticket TASK-5 on 2026-11-05.').ok, false);
  assert.equal(check([{ value: 1000, expression: '2000/2' }], 'Total 1000.', 'Count 2000.').ok, true);
});


test('zero and one remain explicit arithmetic identities without admitting arbitrary small operands', () => {
  assert.equal(check([{ value: '95%', expression: '1 - 5%' }], 'Remaining 95%.', 'The observed defect rate is 5%.').ok, true);
  assert.equal(check([{ value: 55, expression: '0 + 5*11' }], 'Total 55.', 'Count 5 and factor 11.').ok, true);
  assert.equal(check([{ value: 55, expression: '0 + 5*11' }], 'Total 55.', 'Only factor 11 is observed.').ok, false);
});
