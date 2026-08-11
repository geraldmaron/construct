/**
 * tests/docs/org-map.test.ts — the page that describes the catalog cannot
 * quietly stop describing it.
 *
 * This repository's own history is a list of documents that were true when they
 * were written. A seat-by-seat map of the catalog is exactly the kind of
 * document that rots: it is accurate the day it lands and wrong the first time
 * a concern gains a lens or a required section, and nothing about it looks
 * wrong from the outside. So the page is generated, and the gate regenerates
 * and compares — a catalog edit that would have falsified the page fails here
 * instead of shipping.
 *
 * The other assertion is about what the page is allowed to say. It carries the
 * retired depth claim's correction and the routing miss rate; a page that
 * described the seats without either would be selling coverage it does not
 * have, which is the failure mode a map of an organization invites most.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DOMAINS } from '../../src/kernel/implication/domains.ts';

const PAGE = 'docs/org-map.md';

test('the committed page matches what the catalog would generate today', () => {
  const check = spawnSync(process.execPath, ['scripts/generate-org-map.mjs', '--check'], {
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
});

test('every concern in the catalog reaches the page', () => {
  const page = readFileSync(PAGE, 'utf8');
  for (const domain of DOMAINS) {
    assert.ok(page.includes(`\`${domain.domain}\``), `${domain.domain} is missing from the map`);
    // The page opens each entry with the concern as a sentence, so only the
    // first letter differs from the catalog's own wording.
    assert.ok(
      page.toLowerCase().includes(domain.concern.toLowerCase()),
      `${domain.domain}'s stated concern is missing from the map`,
    );
  }
});

test('the page carries the retired claim and the miss rate, not just the seats', () => {
  const page = readFileSync(PAGE, 'utf8');
  // A map of an organization invites exactly one lie — that the map is the
  // territory — and these two sentences are what refuse it.
  assert.match(page, /failed, and was withdrawn/);
  assert.match(page, /Nor is it a completeness claim/);
  assert.match(page, /three in ten/);
  assert.match(page, /You never type a role name/);
});

test('a concern with no lens is listed saying so rather than implying depth', () => {
  const page = readFileSync(PAGE, 'utf8');
  assert.match(page, /\*\*No lens\.\*\*/);
  assert.match(page, /rather than implying depth it does not have/);
});

test('a licensed-review concern says so on its own entry', () => {
  const page = readFileSync(PAGE, 'utf8');
  for (const domain of DOMAINS.filter((d) => d.licensedReview)) {
    const start = page.indexOf(`\`${domain.domain}\``);
    const entry = page.slice(start, page.indexOf('\n### ', start + 1));
    assert.match(
      entry,
      new RegExp(`licensed ${domain.licensedReview}`),
      `${domain.domain} does not name its licensed reviewer`,
    );
  }
});
