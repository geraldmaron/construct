/**
 * tests/kernel/verify/harness-citations.test.ts — a citation naming the
 * org-harness fixture corpus is not evidence about a real run's domain.
 *
 * From the Aug 13 shape-scaling RFC: strategy-alignment cited
 * fixtures/org-harness-broad/corpus/policies/agreements.md and an 18F
 * Strategy.md as if they were Construct's own. Both files sit inside the
 * checkout, so a path-prefix check against the repo root would have allowed
 * them. The org-harness fixture organizations exist so routing and
 * composition can be measured against invented content; they are not a
 * source of strategy, policy, or product fact for any other run — except a
 * run that is itself sweeping that fixture corpus, which this codebase
 * genuinely does, and which must not be refused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeById } from '../../../src/kernel/challenge/catalog.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

// The observed failure shape: a strategy-alignment claim citing the harness
// corpus as though it were Construct's own policy material.
const OBSERVED =
  'State and local agreements follow the standard net-30 template ' +
  '[cite:fixtures/org-harness-broad/corpus/policies/agreements.md].';

function brief(challenges: readonly string[] = []): Brief {
  return {
    id: 't-strategy-alignment',
    outcome: 'Align our contracting posture with the current market position',
    role: 'strategy',
    inputs: [],
    capabilities: [],
    postconditions: [],
    challenges,
  };
}

test('the Aug 13 failure shape is refused with no declared ground roots', () => {
  const cited = challengeById('claims-cited');
  assert.ok(cited?.structural);
  const check = cited.structural(OBSERVED, brief());
  assert.equal(check.passed, false);
  assert.match(check.detail, /org-harness fixture corpus/);
  assert.match(check.detail, /not as evidence about a real domain/);
});

test('the same citation is refused when the declared ground roots name something else', () => {
  const cited = challengeById('claims-cited');
  assert.ok(cited?.structural);
  const check = cited.structural(OBSERVED, brief(), { groundRoots: ['/ground/repo'] });
  assert.equal(check.passed, false);
  assert.match(check.detail, /org-harness fixture corpus/);
});

test('a legitimate fixture-sweep run — one whose own ground roots name the corpus — is not refused', () => {
  const cited = challengeById('claims-cited');
  assert.ok(cited?.structural);
  const check = cited.structural(OBSERVED, brief(), {
    groundRoots: ['fixtures/org-harness-broad'],
  });
  assert.equal(check.passed, true);
});

test('the non-broad sibling corpus is refused the same way, and its own sweep is exempt too', () => {
  const cited = challengeById('claims-cited');
  assert.ok(cited?.structural);
  const line = 'Our roadmap mirrors the recorded plan [cite:fixtures/org-harness/corpus/strategy.md].';
  const refused = cited.structural(line, brief());
  assert.equal(refused.passed, false);

  const exempt = cited.structural(line, brief(), { groundRoots: ['fixtures/org-harness'] });
  assert.equal(exempt.passed, true);
});

test('a real citation elsewhere in the deliverable keeps passing regardless', () => {
  const cited = challengeById('claims-cited');
  assert.ok(cited?.structural);
  const clean =
    'Revenue grew to $4.2M last quarter [cite:q3-report.pdf]. ' +
    'The rate is set in the signed agreement [cite:agreement.pdf, section 4].';
  const check = cited.structural(clean, brief());
  assert.equal(check.passed, true);
});
