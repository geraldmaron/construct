/**
 * tests/kernel/plan/lenses.test.ts — the role lenses are committed depth:
 * every lens points at real catalog domains, the deepened templates carry the
 * lens slots, the legal lens declares its jurisdiction boundary honestly, and
 * the engineering lens states its own ceiling.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, lensByName, lensForDomain } from '../../../src/kernel/plan/lenses.ts';
import { playbookFor } from '../../../src/kernel/plan/playbooks.ts';
import { DOMAINS } from '../../../src/kernel/implication/domains.ts';

test('every lens domain names a catalog domain — no second role registry', () => {
  const known = new Set(DOMAINS.map((d) => d.domain));
  for (const lens of LENSES) {
    for (const domain of lens.domains) {
      assert.ok(known.has(domain), `${lens.lens} points at unknown domain ${domain}`);
    }
  }
});

test('no two lenses claim the same domain', () => {
  const seen = new Map<string, string>();
  for (const lens of LENSES) {
    for (const domain of lens.domains) {
      const prior = seen.get(domain);
      assert.equal(prior, undefined, `${domain} claimed by both ${prior} and ${lens.lens}`);
      seen.set(domain, lens.lens);
    }
  }
});

test('a lens that no domain routes to says so itself — no silently unreachable lens', () => {
  for (const lens of LENSES) {
    if (lens.domains.length > 0) continue;
    assert.ok(
      lens.ceiling && lens.ceiling.length > 0,
      `${lens.lens} is unreachable by dispatch and does not say why — either route it or state the ceiling`,
    );
  }
});

test('the analyst lens reaches dispatch through a catalog domain', () => {
  const analyst = lensByName('analyst');
  assert.ok(analyst, 'analyst lens exists');
  assert.deepEqual(analyst.domains, ['measurement']);
  assert.equal(lensForDomain('measurement')?.lens, 'analyst');
  assert.ok(
    playbookFor('measurement').template.slots.some((s) => s.name === 'measurement-gaps'),
    'the lens slot reaches the measurement template',
  );
});

test('every lens carries a posture, questions, and an escalation ladder', () => {
  for (const lens of LENSES) {
    assert.ok(lens.posture.length > 0, `${lens.lens} has no posture`);
    assert.ok(lens.questions.length >= 2, `${lens.lens} has fewer than two questions`);
    assert.ok(lens.escalation.length >= 1, `${lens.lens} has no escalation ladder`);
  }
});

test('an equipped domain template carries the lens slots, undoubled', () => {
  const compliance = playbookFor('compliance').template;
  assert.ok(
    compliance.slots.some((s) => s.name === 'access-and-audit'),
    'compliance template misses the lens slot',
  );
  const names = compliance.slots.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, 'duplicate slot names');

  // A legal-lens domain whose base template already names licensed-review
  // keeps one copy, plus the lens's provenance slot.
  const contracts = playbookFor('contracts').template;
  assert.equal(
    contracts.slots.filter((s) => s.name === 'licensed-review').length,
    1,
    'licensed-review doubled',
  );
  assert.ok(contracts.slots.some((s) => s.name === 'provenance-and-authorship'));
});

test('a domain no lens equips keeps its template untouched', () => {
  const commerce = playbookFor('commerce-tax').template;
  assert.equal(lensForDomain('commerce-tax'), undefined);
  assert.deepEqual(commerce, playbookFor('no-such-domain').template);
});

test('the security lens equips the domain that already routed without one', () => {
  const security = playbookFor('security').template;
  assert.equal(lensForDomain('security')?.lens, 'security');
  assert.ok(security.slots.some((s) => s.name === 'attack-surface'), 'the base template survives');
  assert.ok(security.slots.some((s) => s.name === 'threat-paths'), 'the lens slot is added');
});

test('the design lens equips both the new experience concern and accessibility', () => {
  assert.equal(lensForDomain('user-experience')?.lens, 'design');
  assert.equal(lensForDomain('accessibility')?.lens, 'design');
  assert.ok(
    playbookFor('accessibility').template.slots.some((s) => s.name === 'flow-dead-ends'),
    'accessibility keeps its own concern and gains the lens slots',
  );
});

test('the legal lens declares no covered jurisdiction until licensed review, and labels for review', () => {
  const legal = lensByName('legal');
  assert.ok(legal);
  assert.equal(legal.jurisdictions?.covered.length, 0);
  assert.match(legal.jurisdictions?.outside ?? '', /licensed/i);
  assert.match(legal.labeling ?? '', /template-for-review/);
  assert.match(legal.labeling ?? '', /dogfood-only/);
});

test('the compliance lens is labeled dogfood-only until licensed review', () => {
  assert.match(lensByName('compliance')?.labeling ?? '', /dogfood-only/);
});

test('the engineering lens states its own ceiling and equips no domain', () => {
  const engineering = lensByName('engineering');
  assert.ok(engineering);
  assert.equal(engineering.domains.length, 0);
  assert.match(engineering.ceiling ?? '', /hosts are the engineers/);
  assert.match(engineering.ceiling ?? '', /no code review/i);
});
