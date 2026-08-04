/**
 * tests/kernel/brief/tiers.test.ts — the model capability floor (construct-ap0).
 *
 * Two properties carry this feature, and they pull against each other. A floor
 * has to be comparable across hosts that share no model names, which is why the
 * kernel only ever sees an ordinal. And an unmet floor has to be loud without
 * being fatal, because refusing would make the free local-model path unusable
 * for the work it was chosen for.
 *
 * The direction of failure is the thing worth pinning: an UNKNOWN tier must not
 * satisfy a floor. Treating "the host did not say" as compliance is the same
 * mistake as reading a host's cost 0 as free, and that one has already been made
 * here once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_TIERS, isModelTier, meetsFloor, tierRank } from '../../../src/kernel/brief/tiers.ts';
import { validateBrief } from '../../../src/kernel/brief/schema.ts';
import { satisfyBrief } from '../../../src/kernel/brief/satisfy.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

function brief(extra: Partial<Brief> = {}): Brief {
  return {
    id: 'b-1',
    outcome: 'decide whether the reseller agreement can be signed',
    role: 'privacy',
    inputs: [],
    capabilities: [],
    postconditions: [],
    ...extra,
  };
}

const AVAILABLE = { tools: [], roles: ['privacy'] };

test('the scale is ordered weakest to strongest and that order is the semantics', () => {
  assert.deepEqual([...MODEL_TIERS], ['any', 'capable', 'frontier']);
  assert.ok(tierRank('any') < tierRank('capable'));
  assert.ok(tierRank('capable') < tierRank('frontier'));
});

test('a floor is met by its own tier and anything stronger', () => {
  assert.equal(meetsFloor('capable', 'capable'), true);
  assert.equal(meetsFloor('frontier', 'capable'), true);
  assert.equal(meetsFloor('any', 'capable'), false);
  assert.equal(meetsFloor('capable', 'frontier'), false);
});

test('an undeclared tier satisfies no floor above "any"', () => {
  // The load-bearing direction: silence is not compliance.
  assert.equal(meetsFloor(null, 'capable'), false);
  assert.equal(meetsFloor(undefined, 'frontier'), false);
  // ...but a brief that asked for nothing is satisfied by anything, including
  // a host that says nothing at all.
  assert.equal(meetsFloor(null, 'any'), true);
});

test('a brief may declare a tier, and may not declare a model name', () => {
  assert.equal(validateBrief(brief({ modelFloor: 'frontier' })).ok, true);
  assert.equal(validateBrief(brief()).ok, true, 'the floor is optional');

  const named = validateBrief(brief({ modelFloor: 'claude-opus-5' as never }));
  assert.equal(named.ok, false);
  assert.match(
    named.problems[0].problem,
    /a tier, never a model name/,
    'a vendor string in the kernel is the thing this scale exists to prevent',
  );
  assert.equal(named.problems[0].field, 'modelFloor');
});

test('running below the floor is a degradation, not an unsatisfied requirement', () => {
  const resolution = satisfyBrief(brief({ modelFloor: 'frontier' }), {
    ...AVAILABLE,
    modelTier: 'any',
    model: 'ollama/qwen3.5:4b',
  });

  assert.equal(resolution.ok, true, 'the work still runs — refusing would break the free path');
  assert.equal(resolution.unsatisfied.length, 0);
  assert.equal(resolution.degradations.length, 1);
  assert.equal(resolution.degradations[0].kind, 'below-model-floor');
  assert.match(resolution.degradations[0].why, /ollama\/qwen3\.5:4b/, 'the record names what ran');
  assert.match(resolution.degradations[0].why, /qualified by that/);
});

test('a host that will not name its tier is recorded as not saying', () => {
  const resolution = satisfyBrief(brief({ modelFloor: 'capable' }), AVAILABLE);
  assert.equal(resolution.ok, true);
  assert.equal(resolution.degradations.length, 1);
  assert.match(resolution.degradations[0].why, /the host did not say/);
});

test('a met floor and an absent floor both leave the record clean', () => {
  const met = satisfyBrief(brief({ modelFloor: 'capable' }), { ...AVAILABLE, modelTier: 'frontier' });
  assert.deepEqual(met.degradations, [], 'a satisfied floor must not warn');

  const none = satisfyBrief(brief(), { ...AVAILABLE, modelTier: 'any' });
  assert.deepEqual(none.degradations, [], 'a brief declaring no floor gets no floor');
});

test('isModelTier rejects everything outside the scale', () => {
  assert.equal(isModelTier('capable'), true);
  assert.equal(isModelTier('Frontier'), false, 'the ordinal is exact, not fuzzy');
  assert.equal(isModelTier('gpt-4'), false);
  assert.equal(isModelTier(undefined), false);
  assert.equal(isModelTier(3), false);
});
