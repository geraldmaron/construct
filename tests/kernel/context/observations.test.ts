/**
 * tests/kernel/context/observations.test.ts — the drift observation screen.
 *
 * The properties held here: no citation means discarded with the reason
 * visible, a citation to an undeclared or retired source is discarded as
 * fabricated provenance, drift requires two distinct documents, and roles
 * restating the same drift merge into one attributed flag whose citations
 * union rather than repeat.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Source } from '../../../src/kernel/store/sources.ts';
import {
  screenObservations,
  type Observation,
} from '../../../src/kernel/context/observations.ts';

const AT = '2026-08-05T00:00:00.000Z';

const SOURCES: Source[] = [
  { id: 'src-docs', workspace: 'acme', kind: 'docs', locator: 'wiki', addedAt: AT, retiredAt: null },
  { id: 'src-git', workspace: 'acme', kind: 'git', locator: 'repo', addedAt: AT, retiredAt: null },
  { id: 'src-old', workspace: 'acme', kind: 'jira', locator: 'OLD', addedAt: AT, retiredAt: AT },
];

const DRIFT: Observation = {
  role: 'strategist',
  claim: 'the PRD promises SSO at launch but the strategy defers identity work to next year',
  citations: [
    { source: 'src-docs', document: 'docs/prd.md' },
    { source: 'src-docs', document: 'docs/strategy.md' },
  ],
};

test('a cited two-document drift survives; the uncited observation is discarded with its reason', () => {
  const result = screenObservations(
    [DRIFT, { role: 'reviewer', claim: 'the roadmap feels ambitious', citations: [] }],
    SOURCES,
  );
  assert.equal(result.flags.length, 1);
  assert.deepEqual(result.flags[0]?.roles, ['strategist']);
  assert.equal(result.discarded.length, 1);
  assert.match(result.discarded[0]?.reason ?? '', /no citation/);
});

test('citing an undeclared or retired source discards the observation', () => {
  const result = screenObservations(
    [
      {
        ...DRIFT,
        citations: [
          { source: 'src-docs', document: 'docs/prd.md' },
          { source: 'src-nope', document: 'somewhere' },
        ],
      },
      {
        ...DRIFT,
        role: 'other',
        citations: [
          { source: 'src-docs', document: 'docs/prd.md' },
          { source: 'src-old', document: 'OLD-3' },
        ],
      },
    ],
    SOURCES,
  );
  assert.equal(result.flags.length, 0);
  assert.match(result.discarded[0]?.reason ?? '', /src-nope/);
  assert.match(result.discarded[1]?.reason ?? '', /src-old/);
});

test('drift takes two: one document cited twice is still one side', () => {
  const result = screenObservations(
    [
      {
        ...DRIFT,
        citations: [
          { source: 'src-docs', document: 'docs/prd.md' },
          { source: 'src-docs', document: 'docs/prd.md' },
        ],
      },
    ],
    SOURCES,
  );
  assert.equal(result.flags.length, 0);
  assert.match(result.discarded[0]?.reason ?? '', /two documents/);
});

test('roles restating the same drift merge into one flag; citations union, wording anchors first', () => {
  const restated: Observation = {
    role: 'reviewer',
    claim: 'strategy defers identity work to next year while the PRD promises SSO at launch',
    citations: [
      { source: 'src-docs', document: 'docs/strategy.md' },
      { source: 'src-git', document: 'README.md' },
    ],
  };
  const unrelated: Observation = {
    role: 'reviewer',
    claim: 'pricing page cites a tier the billing config no longer defines',
    citations: [
      { source: 'src-docs', document: 'docs/pricing.md' },
      { source: 'src-git', document: 'billing/config.json' },
    ],
  };
  const result = screenObservations([DRIFT, restated, unrelated], SOURCES);
  assert.equal(result.flags.length, 2);
  const merged = result.flags[0];
  assert.equal(merged?.claim, DRIFT.claim);
  assert.deepEqual(merged?.roles, ['strategist', 'reviewer']);
  assert.equal(merged?.citations.length, 3);
});
