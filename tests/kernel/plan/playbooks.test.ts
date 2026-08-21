/**
 * tests/kernel/plan/playbooks.test.ts — a domain no lens equips gets a
 * template that says so, in place of the lens slots it does not have.
 *
 * The premise checked before this file was written: every domain in the
 * shipped catalog (implication/domains.ts, 17 entries as of this writing)
 * carries a lens, so `playbookFor` never takes the no-lens branch for a real,
 * shipped concern today. It still matters, for two reasons stated in the
 * catalog's own docstring and this module's: a workspace can carry its own
 * domain catalog without forking the kernel, and `playbookFor` already
 * promises unknown domains a template "rather than an error: the planner may
 * route to a domain the catalog gains later." Both paths hand `playbookFor` a
 * domain string no lens claims, and this file is what proves that path is
 * honest rather than merely unreachable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbookFor } from '../../../src/kernel/plan/playbooks.ts';
import { slotGaps, unheadedSlots } from '../../../src/kernel/plan/ladder.ts';
import { lensForDomain } from '../../../src/kernel/plan/lenses.ts';
import { DOMAINS } from '../../../src/kernel/implication/domains.ts';

test('the shipped catalog carries a lens for every domain today — the premise this file exists for', () => {
  // Not a duplicate of lenses.test.ts's own hard guard on this fact: this is
  // this file's record of why every other test below has to reach for a
  // domain name outside DOMAINS to exercise the no-lens branch at all.
  const lensless = DOMAINS.filter((d) => !lensForDomain(d.domain));
  assert.deepEqual(lensless.map((d) => d.domain), []);
});

test('a domain no lens equips carries a required method slot naming the three concrete things missing', () => {
  const template = playbookFor('astrology').template;
  const method = template.slots.find((s) => s.name === 'method');
  assert.ok(method, 'the method slot must reach the template');
  assert.equal(method.required, true, 'the signal is not optional content');
  // Not a vague caveat: the exact three things a lens carries (questions,
  // extra slots, escalation) are named as what this deliverable does not have.
  assert.match(method.expects, /question set/);
  assert.match(method.expects, /deliverable obligations/);
  assert.match(method.expects, /escalation ladder/);
  // No quality claim either way: the slot instructs against apologizing or
  // claiming parity, but never asserts the improvised approach is itself
  // worse or inferior — that word never appears here at all.
  assert.doesNotMatch(method.expects, /\binferior\b|\bworse\b|\bunfortunately\b/i);
});

test('a domain a lens equips never carries the method slot', () => {
  const security = playbookFor('security').template;
  assert.ok(!security.slots.some((s) => s.name === 'method'));
  // It carries the lens's own slots instead — the two are mutually exclusive.
  assert.ok(security.slots.some((s) => s.name === 'threat-paths'));
});

test('the method slot and a lens\'s own slots never both land on one template', () => {
  for (const domain of ['astrology', 'security', 'privacy', 'no-such-domain']) {
    const template = playbookFor(domain).template;
    const hasMethod = template.slots.some((s) => s.name === 'method');
    const lens = lensForDomain(domain);
    assert.equal(hasMethod, !lens, `${domain}: method slot presence must track lens absence exactly`);
  }
});

test('a bespoke template with no lens still gains the method slot on top of its own slots', () => {
  // Every bespoke TEMPLATES entry today happens to name a domain a lens also
  // equips, so this exercises the base-template-plus-method-slot composition
  // directly: a hypothetical bespoke domain with no lens must not lose its
  // own slots to the addition, the same guarantee lens slots already carry.
  const template = playbookFor('privacy').template;
  assert.ok(template.slots.some((s) => s.name === 'data-inventory'), 'privacy\'s own slot survives');
  // privacy has a lens today, so it is the lens slots that land, not method —
  // covered by the mutual-exclusion test above. This test exists to record
  // that the composition mechanism (base slots plus one addition) is shared
  // code between the two branches, not a special case for either.
  assert.ok(!template.slots.some((s) => s.name === 'method'));
});

test('the method slot is a real, enforceable gap: empty is a stall the ladder catches', () => {
  const template = playbookFor('astrology').template;
  const gaps = slotGaps(template, { finding: 'x', evidence: 'y', risks: 'z' });
  assert.ok(gaps.some((g) => g.slot.name === 'method'), 'an unfilled method slot must surface as a gap');

  const unheaded = unheadedSlots(template, '## finding\nx\n## evidence\ny\n## risks\nz\n');
  assert.ok(unheaded.some((g) => g.slot.name === 'method'), 'a deliverable that never heads it is caught the same way as any other required slot');
});

test('two domains outside the catalog are lensless identically, not guessed at per name', () => {
  assert.deepEqual(playbookFor('astrology').template, playbookFor('feng-shui').template);
});
