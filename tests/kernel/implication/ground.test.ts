/**
 * tests/kernel/implication/ground.test.ts — seating from artifact identity,
 * not from a keyword map over the user's sentence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapImplications } from '../../../src/kernel/implication/map.ts';
import {
  mergeSeats,
  pathNamesDomain,
  seatFromVisibleGround,
  titleNamesDomain,
} from '../../../src/kernel/implication/ground.ts';

const POLAND = 'We want to hire a contractor in Poland';

test('path identity seats a catalog domain; contractor does not stem to contracts', () => {
  assert.equal(pathNamesDomain('contracts/statement-of-work.md', 'contracts'), true);
  assert.equal(pathNamesDomain('privacy-policy.md', 'privacy'), true);
  assert.equal(pathNamesDomain('cross-border-privacy.md', 'privacy'), true);
  assert.equal(pathNamesDomain('contractor-agreement.md', 'contracts'), false);
  assert.equal(pathNamesDomain('contractor-agreement.md', 'employment'), false);
});

test('a heading that is the domain name seats it; a nearby word does not', () => {
  assert.equal(titleNamesDomain('Privacy', 'privacy'), true);
  assert.equal(titleNamesDomain('Contracts: statement of work', 'contracts'), true);
  assert.equal(titleNamesDomain('Contractor agreement', 'contracts'), false);
});

test('keyword map on the Poland sentence is employment-only — that is not 1+3', () => {
  const domains = mapImplications({ outcome: POLAND }).implicated.map((row) => row.domain);
  assert.deepEqual(domains, ['employment']);
  assert.ok(!domains.includes('contracts'));
  assert.ok(!domains.includes('privacy'));
});

test('visible contracts and privacy artifacts seat those domains without scoring the sentence', () => {
  const seated = seatFromVisibleGround({
    documents: [
      { path: '/ground/contracts/statement-of-work.md', title: 'Contracts' },
      { path: '/ground/privacy/cross-border-notice.md', title: 'Privacy' },
    ],
  });
  const domains = seated.map((row) => row.domain);
  assert.deepEqual(domains, ['privacy', 'contracts']);
  assert.ok(seated.every((row) => row.signals.some((s) => s.startsWith('visible document:'))));
});

test('merge keeps host namings and adds only the unnamed ground seats', () => {
  const merged = mergeSeats(
    [
      {
        domain: 'employment',
        concern: 'people you engage and how you engage them',
        score: 0,
        signals: ['the host named employment'],
      },
    ],
    seatFromVisibleGround({
      documents: [
        { path: 'contracts/sow.md' },
        { path: 'privacy/notice.md' },
        { path: 'employment/handbook.md' },
      ],
    }),
  );
  assert.deepEqual(
    merged.map((row) => row.domain),
    ['employment', 'privacy', 'contracts'],
  );
});
