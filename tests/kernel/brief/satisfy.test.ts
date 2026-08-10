/**
 * tests/kernel/brief/satisfy.test.ts — commitment 10, asserted.
 *
 * The property that matters is the failure mode: an unsatisfiable brief must
 * fail loudly rather than resolve to something near enough. Every test here that
 * looks like it is checking an error message is really checking that the system
 * refused to proceed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBrief } from '../../../src/kernel/brief/schema.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';
import { explainUnsatisfied, satisfyBrief } from '../../../src/kernel/brief/satisfy.ts';
import { describePostconditions } from '../../../src/kernel/capabilities/postconditions.ts';

const BRIEF: Brief = {
  id: 'b1',
  outcome: 'Launch a paid beta to EU users next month',
  role: 'reviewer',
  inputs: [
    { name: 'diff', description: 'the change under review', required: true },
    { name: 'style-guide', description: 'optional house style', required: false },
  ],
  capabilities: ['read-repo', 'search-web'],
  postconditions: [],
};

const AVAILABLE = {
  tools: [
    { name: 'fs', capabilities: ['read-repo', 'write-files'] },
    { name: 'brave', capabilities: ['search-web'] },
  ],
  roles: ['reviewer', 'issue-spotter'],
  inputs: ['diff'],
};

test('a satisfiable brief binds each capability to a concrete tool', () => {
  const resolution = satisfyBrief(BRIEF, AVAILABLE);
  assert.ok(resolution.ok, explainUnsatisfied(resolution));
  assert.deepEqual(resolution.bindings, [
    { capability: 'read-repo', tool: 'fs' },
    { capability: 'search-web', tool: 'brave' },
  ]);
});

test('an empty postcondition declaration means the role defaults, never none', () => {
  const resolution = satisfyBrief(BRIEF, AVAILABLE);
  // No rules ship registered, so the default is empty — but it is the
  // REGISTRY's answer for this role, not a shortcut past asking.
  assert.deepEqual(resolution.postconditions, describePostconditions(BRIEF.role).map((p) => p.id));
});

test('a missing capability is unsatisfied, not silently dropped', () => {
  const resolution = satisfyBrief(
    { ...BRIEF, capabilities: ['read-repo', 'send-email'] },
    AVAILABLE,
  );
  assert.equal(resolution.ok, false);
  const failure = resolution.unsatisfied.find((u) => u.kind === 'missing-capability');
  assert.equal(failure?.what, 'send-email');
  assert.ok(
    !resolution.bindings.some((b) => b.capability === 'send-email'),
    'an unmet capability must never be bound to a near-enough tool',
  );
});

test('a missing required input blocks dispatch; a missing optional one does not', () => {
  const missingRequired = satisfyBrief(BRIEF, { ...AVAILABLE, inputs: [] });
  assert.equal(missingRequired.ok, false);
  assert.equal(missingRequired.unsatisfied[0].kind, 'missing-input');
  assert.equal(missingRequired.unsatisfied[0].what, 'diff');

  // 'style-guide' is optional and absent — still satisfiable.
  assert.ok(satisfyBrief(BRIEF, AVAILABLE).ok);
});

test('an unknown role is unsatisfied', () => {
  const resolution = satisfyBrief({ ...BRIEF, role: 'wizard' }, AVAILABLE);
  assert.equal(resolution.ok, false);
  assert.ok(resolution.unsatisfied.some((u) => u.kind === 'unknown-role'));
});

test('a postcondition that cannot be enforced is refused, not assumed', () => {
  const resolution = satisfyBrief(
    { ...BRIEF, postconditions: ['reviewer.invented-rule'] },
    AVAILABLE,
  );
  assert.equal(resolution.ok, false);
  const failure = resolution.unsatisfied.find((u) => u.kind === 'unknown-postcondition');
  assert.ok(failure);
  assert.match(failure.why, /cannot be enforced/);
});

test('resolution is deterministic: first tool providing a capability wins', () => {
  const twoProviders = {
    ...AVAILABLE,
    tools: [
      { name: 'fs', capabilities: ['read-repo'] },
      { name: 'git', capabilities: ['read-repo'] },
      { name: 'brave', capabilities: ['search-web'] },
    ],
  };
  const a = satisfyBrief(BRIEF, twoProviders);
  const b = satisfyBrief(BRIEF, twoProviders);
  assert.deepEqual(a, b);
  assert.equal(a.bindings[0].tool, 'fs');
});

test('a brief that names a concrete tool is malformed — it is orchestrating itself', () => {
  const validation = validateBrief({ ...BRIEF, capabilities: ['mcp::brave-search'] });
  assert.equal(validation.ok, false);
  assert.match(validation.problems[0].problem, /commitment 10/);
});

test('a malformed brief never reaches resolution', () => {
  const resolution = satisfyBrief({ ...BRIEF, id: '' }, AVAILABLE);
  assert.equal(resolution.ok, false);
  assert.equal(resolution.unsatisfied[0].kind, 'malformed-brief');
  assert.deepEqual(resolution.bindings, [], 'nothing binds until the brief is well-formed');
});

test('an input with no stated required flag is malformed', () => {
  const validation = validateBrief({
    ...BRIEF,
    inputs: [{ name: 'diff', description: 'd' }],
  });
  assert.equal(validation.ok, false);
  assert.match(validation.problems[0].problem, /hides a hard failure/);
});

test('explainUnsatisfied names every unmet requirement', () => {
  const resolution = satisfyBrief(
    { ...BRIEF, role: 'wizard', capabilities: ['send-email'] },
    { ...AVAILABLE, inputs: [] },
  );
  const explained = explainUnsatisfied(resolution);
  assert.match(explained, /unknown-role/);
  assert.match(explained, /missing-input/);
  assert.match(explained, /missing-capability/);
});
