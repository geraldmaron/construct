/**
 * The catalog's own discipline: a concern that ships without saying when it
 * applies routes anyway, silently and worse. These tests are the reason the
 * conditions are required rather than encouraged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DOMAINS } from '../../../src/kernel/implication/domains.ts';
import { namerPrompt } from '../../../src/hosts/namer.ts';

test('every concern states when it applies', () => {
  for (const domain of DOMAINS) {
    assert.ok(
      domain.implicatedWhen.length > 0,
      `${domain.domain} ships with no condition under which it applies, so the router has only its name to reason from`,
    );
  }
});

test('a condition is a situation, not a phrase to look for', () => {
  for (const domain of DOMAINS) {
    for (const condition of [...domain.implicatedWhen, ...domain.notImplicatedWhen]) {
      // A condition short enough to be a keyword is one: it describes a word
      // rather than a circumstance, and the keyword list is where those go.
      assert.ok(
        condition.split(/\s+/).length >= 6,
        `${domain.domain} states "${condition}" as a condition, which is short enough to be a keyword rather than a situation`,
      );
    }
  }
});

test('the false friends that have actually cost precision are named', () => {
  // Each of these is a measured over-fire (RESEARCH-DECISIONS.md section 3).
  // The knowledge used to live in a comment addressed to the next maintainer,
  // where the thing making the routing decision could never read it.
  const named = (domain: string, needle: string): boolean =>
    DOMAINS.find((d) => d.domain === domain)!
      .notImplicatedWhen.some((n) => n.toLowerCase().includes(needle));

  assert.ok(named('contracts', 'sign'), 'contracts must exclude signing in / single sign-on');
  assert.ok(named('contracts', 'terms'), 'contracts must exclude product vocabulary called "terms"');
  assert.ok(
    named('product-scoping', 'who it is for'),
    'product-scoping must exclude naming users as who the work is for',
  );
  assert.ok(
    named('program-sequencing', 'release'),
    'program-sequencing must exclude "release" naming an artifact rather than an event',
  );
});

test('the prompt the router reads carries the conditions, not just the names', () => {
  const prompt = namerPrompt('we want to hire a contractor in Poland', DOMAINS);
  for (const domain of DOMAINS) {
    assert.ok(prompt.includes(domain.domain), `${domain.domain} missing from the prompt`);
    for (const condition of domain.implicatedWhen) {
      assert.ok(
        prompt.includes(condition),
        `${domain.domain} states a condition the router is never shown: "${condition}"`,
      );
    }
    for (const condition of domain.notImplicatedWhen) {
      assert.ok(
        prompt.includes(condition),
        `${domain.domain} states an exclusion the router is never shown: "${condition}"`,
      );
    }
  }
});

test('keywords are the fallback path only, and no concern rests on them alone', () => {
  // A concern with keywords but no conditions would work offline and degrade
  // silently the moment a host is present — which is the shipped path.
  for (const domain of DOMAINS) {
    if (domain.keywords.length === 0) continue;
    assert.ok(
      domain.implicatedWhen.length > 0,
      `${domain.domain} can be reached by keyword but tells the model nothing`,
    );
  }
});
