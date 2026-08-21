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

test('a domain no lens equips gets the method slot, naming what a lens would have supplied', () => {
  assert.equal(lensForDomain('no-such-domain'), undefined);
  const template = playbookFor('no-such-domain').template;
  const method = template.slots.find((s) => s.name === 'method');
  assert.ok(method, 'a lensless domain must carry the slot that says so — silence is not the base template');
  assert.equal(method.required, true);
  assert.match(method.expects, /question set/);
  assert.match(method.expects, /escalation ladder/);
  // Any two unknown domains are lensless the same way, so they still produce
  // identical templates — the absence is uniform, not per-domain guesswork.
  assert.deepEqual(template, playbookFor('also-unknown').template);
});

test('every catalog domain carries a lens, so no concern routes bare', () => {
  // The last two holes (commerce-tax, marketing-claims) routed for months with
  // no posture, no question set, and no slots — dispatched on the default memo
  // while every neighbouring concern got a practitioner's lens. This test makes
  // the next hole a failing build instead of an audit finding.
  for (const domain of DOMAINS) {
    assert.ok(
      lensForDomain(domain.domain),
      `domain "${domain.domain}" routes but no lens equips it`,
    );
  }
});

test('the commerce lens equips taking money with obligations named where they attach', () => {
  const lens = lensForDomain('commerce-tax');
  assert.equal(lens?.lens, 'commerce');
  assert.match(lens!.labeling ?? '', /never tax advice/);
  assert.ok(playbookFor('commerce-tax').template.slots.some((s) => s.name === 'money-flow'));
});

test('the brand lens holds public claims to substantiation that exists today', () => {
  const lens = lensForDomain('marketing-claims');
  assert.equal(lens?.lens, 'brand');
  assert.ok(lens!.questions.some((q) => /substantiation exists today/.test(q)));
  assert.ok(playbookFor('marketing-claims').template.slots.some((s) => s.name === 'claims-inventory'));
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

test('the two evidence concerns route to their own lens and stay apart', () => {
  // The pair was added together and the reason they are two is the whole
  // point: one asks whether what is said is traceable, the other whether what
  // is unsaid is a bias. A single lens answering both would answer whichever
  // is easier on the material in front of it.
  assert.equal(lensForDomain('evidence-provenance')?.lens, 'research');
  assert.equal(lensForDomain('coverage-gaps')?.lens, 'coverage');
  assert.notDeepEqual(
    lensByName('research')?.domains,
    lensByName('coverage')?.domains,
    'two lenses on one domain would make coverage of it unfalsifiable',
  );
});

test('the research lens requires the source class beside the claim, not just a source', () => {
  const template = playbookFor('evidence-provenance').template;
  const provenance = template.slots.find((s) => s.name === 'claim-provenance');
  assert.ok(provenance, 'the provenance slot must reach the deliverable template');
  // A citation with no source class reads identically whether it names the
  // record or somebody's summary of it, which is the defect this slot exists
  // to make visible.
  assert.match(provenance.expects, /aggregator/);
  assert.match(provenance.expects, /inference/);
  assert.ok(template.slots.some((s) => s.name === 'single-source-claims'));
});

test('the coverage lens requires each absence to be classified, never merely counted', () => {
  const template = playbookFor('coverage-gaps').template;
  const absences = template.slots.find((s) => s.name === 'absences');
  assert.ok(absences, 'the absences slot must reach the deliverable template');
  assert.match(absences.expects, /not-recorded/);
  assert.match(absences.expects, /did-not-happen/);
  assert.ok(template.slots.some((s) => s.name === 'coverage-frame'));
});

test('the research lens states the limit it does not cross: traceable is not true', () => {
  const research = lensByName('research');
  assert.ok(research?.ceiling, 'a lens that judges evidence must state what it does not judge');
  assert.match(research.ceiling, /never|not/);
  assert.ok(lensByName('coverage')?.ceiling, 'the coverage lens must state its own ceiling');
});
