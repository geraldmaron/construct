/**
 * tests/kernel/verify/source-citations.test.ts — a citation that points at code
 * is not a citation.
 *
 * From a real run: an employment-law question answered by reading this tool's
 * own installed package, citing a module of keyword definitions as the
 * authority. The deliverable looked sourced. A citation is the unit of trust
 * here, so a deliverable that looks sourced and is not does more damage than
 * one that plainly is not, and the whole point of this check is that it fails
 * without asking a model whether the source was any good.
 *
 * The line it has to hold is between a path and a filename in prose. A user's
 * own `agreement.pdf` is a legitimate thing to cite; `src/kernel/x.ts` is the
 * tool's insides or the user's repository, and neither is evidence about a
 * domain.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSourceFileCitations } from '../../../src/kernel/verify/claims.ts';
import { challengeById } from '../../../src/kernel/challenge/catalog.ts';
import { assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const OBSERVED =
  'Employment status turns on how the work is performed ' +
  '[cite:kernel/implication/domains.js — employment domain keywords].';

function brief(challenges: readonly string[] = []): Brief {
  return {
    id: 't-employment',
    outcome: 'We want to hire a contractor in Poland',
    role: 'employment',
    inputs: [],
    capabilities: [],
    postconditions: [],
    challenges,
  };
}

test('the citation observed on the real run is caught, with its line', () => {
  const found = findSourceFileCitations(`# Employment read\n${OBSERVED}`);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
});

test('a real source is left alone, including one that names a file in prose', () => {
  const fine = [
    'A breach must be reported within 72 hours [cite:GDPR Article 33(1)].',
    'The rate is set in the signed agreement [cite:agreement.pdf, section 4].',
    'The team decided this on 2026-08-05 [cite:decision log, entry 12].',
    'Nothing here is sourced yet [unverified].',
  ].join('\n');
  assert.deepEqual(findSourceFileCitations(fine), []);
});

test('the citation challenge fails it, and says why in words a role can act on', () => {
  const cited = challengeById('claims-cited');
  assert.ok(cited?.structural);
  const check = cited.structural(OBSERVED, brief());
  assert.equal(check.passed, false);
  assert.match(check.detail, /point at a source file rather than a source/);
  assert.match(check.detail, /not evidence about this domain/);
});

test('the role is told the rule before it writes, not only held to it after', () => {
  const assignment = assignmentFor(brief());
  assert.match(assignment, /Never cite a file path as the source for a claim/);
  // And it is told what to do instead, because a prohibition with no
  // alternative is answered by inventing a source.
  assert.match(assignment, /mark it \[unverified\] and say what would settle it/);
});

test('a cited code path under a declared ground root is evidence, not a misplaced citation', () => {
  const grounded =
    'The lease fence drops a stale settle [cite:/ground/repo/src/kernel/store/tasks.ts].';
  assert.deepEqual(findSourceFileCitations(grounded, ['/ground/repo']), []);
  assert.equal(
    findSourceFileCitations(grounded, ['/other/root']).length,
    1,
    'a root the run was not licensed for vouches for nothing',
  );
  assert.equal(
    findSourceFileCitations(grounded).length,
    1,
    'no roots means the original rule, unchanged',
  );
});
