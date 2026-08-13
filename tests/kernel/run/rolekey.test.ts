/**
 * tests/kernel/run/rolekey.test.ts — matching a written role name against a
 * dispatched one, lenient about form and strict about identity.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleLookup, sectionLookup } from '../../../src/kernel/run/rolekey.ts';

const ROLES = ['product-scoping', 'strategy-alignment'];

test('an exact match resolves to itself', () => {
  const resolve = roleLookup(ROLES);
  assert.equal(resolve('product-scoping'), 'product-scoping');
});

test('case and spacing variants resolve to the real identifier', () => {
  const resolve = roleLookup(ROLES);
  assert.equal(resolve('Product Scoping'), 'product-scoping');
  assert.equal(resolve('product_scoping'), 'product-scoping');
  assert.equal(resolve('  STRATEGY-ALIGNMENT  '), 'strategy-alignment');
  assert.equal(resolve('strategy alignment'), 'strategy-alignment');
});

test('nothing that is not a dispatched role resolves, under any spelling', () => {
  const resolve = roleLookup(ROLES);
  assert.equal(resolve('author'), undefined);
  assert.equal(resolve('construct-position'), undefined);
  assert.equal(resolve('AGENTS.md'), undefined);
  assert.equal(resolve('Product team'), undefined);
  assert.equal(resolve('security-incidents.md'), undefined);
});

test('an empty dispatched-role list resolves nothing', () => {
  const resolve = roleLookup([]);
  assert.equal(resolve('product-scoping'), undefined);
});

test('sectionLookup is the identical mechanism, applied to a shape\'s section names', () => {
  const resolve = sectionLookup(['the-problem', 'requirements']);
  assert.equal(resolve('The Problem'), 'the-problem');
  assert.equal(resolve('requirements'), 'requirements');
  assert.equal(resolve('timeline'), undefined);
});
