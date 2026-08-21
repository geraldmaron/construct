/**
 * tests/kernel/context/observations.test.ts — the drift observation screen.
 *
 * The properties held here: no citation means discarded with the reason
 * visible, a citation to an undeclared or retired source is discarded as
 * fabricated provenance, drift requires two distinct documents, and roles
 * restating the same drift merge into one attributed flag whose citations
 * union rather than repeat.
 *
 * And the property that separates a document existing from a document
 * agreeing: where a citation quotes the document it names, the quotation is
 * located in that document's actual words, and a quotation the document does
 * not hold is fabricated provenance however real the path is. Where nothing
 * checkable was quoted, the flag stands and says so — the screen may not
 * silently credit a claim with support it never established.
 *
 * A claim's wording is screened as provenance too, by the same rule and for
 * the same reason. It is the answer to a different question from the citations
 * — which single document this sentence was carried in from, as against which
 * two documents disagree — and it is routinely a document neither citation
 * names.
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

test('a citation into a surveyed source must name a document that survey found', () => {
  const surveyed = new Map([['src-docs', new Set(['docs/prd.md', 'docs/strategy.md'])]]);
  const kept = screenObservations([DRIFT], SOURCES, surveyed);
  assert.equal(kept.flags.length, 1);
  assert.equal(kept.discarded.length, 0);

  const remembered: Observation = {
    role: 'strategist',
    claim: 'the PRD contradicts the pricing memo',
    citations: [
      { source: 'src-docs', document: 'docs/prd.md' },
      { source: 'src-docs', document: 'docs/pricing-memo.md' },
    ],
  };
  const screened = screenObservations([remembered], SOURCES, surveyed);
  assert.equal(screened.flags.length, 0);
  assert.equal(screened.discarded.length, 1);
  assert.match(screened.discarded[0]!.reason, /docs\/pricing-memo\.md/);
  assert.match(screened.discarded[0]!.reason, /survey of that source did not find/);
});

test('a bare basename resolves when one document carries it, and not when two do', () => {
  const unique = new Map([['src-docs', new Set(['a/deep/docs/prd.md', 'b/docs/strategy.md'])]]);
  const byBasename: Observation = {
    ...DRIFT,
    citations: [
      { source: 'src-docs', document: 'prd.md' },
      { source: 'src-docs', document: 'strategy.md' },
    ],
  };
  assert.equal(screenObservations([byBasename], SOURCES, unique).flags.length, 1);

  const ambiguous = new Map([
    ['src-docs', new Set(['a/prd.md', 'b/prd.md', 'b/docs/strategy.md'])],
  ]);
  const screened = screenObservations([byBasename], SOURCES, ambiguous);
  assert.equal(screened.flags.length, 0, 'choosing between two documents is not the screen\'s call');
  assert.match(screened.discarded[0]!.reason, /prd\.md/);
});

/**
 * A ground of two documents that really do disagree, with the PRD's sentence
 * wrapped the way a document wraps one — a reading pass quotes the sentence,
 * not the line breaks.
 */
const GROUND: ReadonlyMap<string, string> = new Map([
  [
    'docs/prd.md',
    '# PRD\n\nSSO ships at launch, in the first release, with no\nadditional licence required.\n',
  ],
  ['docs/strategy.md', '# Strategy\n\nIdentity work is deferred to next year.\n'],
  // Listed by the survey and unreadable to the screen: a document the walk saw
  // and nothing could open.
  ['docs/pricing.pdf', ''],
]);

const SURVEYED = new Map([
  ['src-docs', new Set(['docs/prd.md', 'docs/strategy.md', 'docs/pricing.pdf'])],
]);

function wordsOf(document: string): string | null {
  const text = GROUND.get(document);
  return text ? text : null;
}

function citing(quotes: Readonly<Record<string, string | undefined>>): Observation {
  return {
    ...DRIFT,
    citations: Object.entries(quotes).map(([document, quote]) => ({
      source: 'src-docs',
      document,
      ...(quote === undefined ? {} : { quote }),
    })),
  };
}

test('a claim quoting words its document holds stands, with nothing left unverified', () => {
  const screened = screenObservations(
    [
      citing({
        'docs/prd.md': 'SSO ships at launch',
        'docs/strategy.md': 'Identity work is deferred to next year',
      }),
    ],
    SOURCES,
    SURVEYED,
    wordsOf,
  );
  assert.equal(screened.flags.length, 1);
  assert.equal(screened.flags[0]?.unverifiedSupport, null);
  assert.equal(screened.discarded.length, 0);
});

test('a claim putting words in a document that really exists is discarded as fabricated', () => {
  const screened = screenObservations(
    [
      citing({
        'docs/prd.md': 'SSO ships at launch',
        // The document is real, listed, and says the opposite of this.
        'docs/strategy.md': 'identity work ships in the same release as SSO',
      }),
    ],
    SOURCES,
    SURVEYED,
    wordsOf,
  );
  assert.equal(screened.flags.length, 0);
  assert.equal(screened.discarded.length, 1);
  assert.match(screened.discarded[0]!.reason, /docs\/strategy\.md/);
  assert.match(screened.discarded[0]!.reason, /which that document does not say/);
});

test('a citation that quotes nothing keeps its flag and discloses that support was not checked', () => {
  const screened = screenObservations([DRIFT], SOURCES, SURVEYED, wordsOf);
  assert.equal(screened.flags.length, 1);
  assert.match(screened.flags[0]?.unverifiedSupport ?? '', /docs\/prd\.md is cited without quoting it/);
  assert.match(screened.flags[0]?.unverifiedSupport ?? '', /rests on the documents existing/);
});

test('a quotation is located across the line breaks and elisions a reader introduces', () => {
  const reflowed = screenObservations(
    [
      citing({
        'docs/prd.md': 'sso ships at launch, in the first release, with no additional licence required.',
        'docs/strategy.md': 'Identity work is deferred',
      }),
    ],
    SOURCES,
    SURVEYED,
    wordsOf,
  );
  assert.equal(reflowed.flags.length, 1, 'a sentence quoted whole is the same sentence unwrapped');
  assert.equal(reflowed.flags[0]?.unverifiedSupport, null);

  const elided = screenObservations(
    [citing({ 'docs/prd.md': 'SSO ships at launch … additional licence required', 'docs/strategy.md': 'deferred to next year' })],
    SOURCES,
    SURVEYED,
    wordsOf,
  );
  assert.equal(elided.flags.length, 1);

  // The order an elision asserts is part of what it asserts.
  const reversed = screenObservations(
    [citing({ 'docs/prd.md': 'additional licence required … SSO ships at launch', 'docs/strategy.md': 'deferred to next year' })],
    SOURCES,
    SURVEYED,
    wordsOf,
  );
  assert.equal(reversed.flags.length, 0);
  assert.match(reversed.discarded[0]!.reason, /does not say/);
});

test('a document nobody could open, and a quote too short to locate, are disclosed rather than credited', () => {
  const unreadable = screenObservations(
    [citing({ 'docs/prd.md': 'SSO ships at launch', 'docs/pricing.pdf': 'pricing rises in Q3' })],
    SOURCES,
    SURVEYED,
    wordsOf,
  );
  assert.equal(unreadable.flags.length, 1, 'a document the screen cannot read is not thereby a fabrication');
  assert.match(unreadable.flags[0]?.unverifiedSupport ?? '', /docs\/pricing\.pdf could not be opened/);

  const brief = screenObservations(
    [citing({ 'docs/prd.md': 'SSO', 'docs/strategy.md': 'Identity work is deferred to next year' })],
    SOURCES,
    SURVEYED,
    wordsOf,
  );
  assert.equal(brief.flags.length, 1);
  assert.match(brief.flags[0]?.unverifiedSupport ?? '', /quoted too briefly/);
});

test('a restatement that quoted nothing cannot launder the flag it merges into', () => {
  const quoted = citing({
    'docs/prd.md': 'SSO ships at launch',
    'docs/strategy.md': 'Identity work is deferred to next year',
  });
  const restated: Observation = {
    role: 'reviewer',
    claim: 'strategy defers identity work to next year while the PRD promises SSO at launch',
    citations: [
      { source: 'src-docs', document: 'docs/strategy.md' },
      { source: 'src-docs', document: 'docs/prd.md' },
    ],
  };
  const screened = screenObservations([quoted, restated], SOURCES, SURVEYED, wordsOf);
  assert.equal(screened.flags.length, 1);
  assert.deepEqual(screened.flags[0]?.roles, ['strategist', 'reviewer']);
  assert.match(screened.flags[0]?.unverifiedSupport ?? '', /cited without quoting it/);
});

test('a caller with no way to open the documents checks no quotation and says so on every flag', () => {
  const screened = screenObservations(
    [
      citing({
        'docs/prd.md': 'SSO ships at launch',
        'docs/strategy.md': 'Identity work is deferred to next year',
      }),
    ],
    SOURCES,
    SURVEYED,
  );
  assert.equal(screened.flags.length, 1, 'an unreadable ground is not a fabricated one');
  assert.match(screened.flags[0]?.unverifiedSupport ?? '', /could not be opened/);
});

test('a source nobody could survey is screened on the source alone, not refused', () => {
  const drifted: Observation = {
    role: 'program',
    claim: 'the tracker epic contradicts the strategy document',
    citations: [
      { source: 'src-old', document: 'OLD-14' },
      { source: 'src-docs', document: 'docs/strategy.md' },
    ],
  };
  const live: Source[] = SOURCES.map((s) => (s.id === 'src-old' ? { ...s, retiredAt: null } : s));
  // src-old has no survey entry: it is read through the host's own tools, so
  // there is no listing to check its document against.
  const surveyed = new Map([['src-docs', new Set(['docs/strategy.md'])]]);
  const screened = screenObservations([drifted], live, surveyed);
  assert.equal(screened.flags.length, 1);
  assert.equal(screened.discarded.length, 0);
});

test('a claim keeps the third document its wording came from, which neither citation names', () => {
  const carried: Observation = {
    ...DRIFT,
    wording: { source: 'src-git', document: 'vendor-brief.md' },
  };
  const surveyed = new Map([
    ['src-docs', new Set(['docs/prd.md', 'docs/strategy.md'])],
    ['src-git', new Set(['vendor-brief.md'])],
  ]);
  const result = screenObservations([carried], SOURCES, surveyed);
  assert.equal(result.flags.length, 1);
  assert.deepEqual(result.flags[0]?.wording, [{ source: 'src-git', document: 'vendor-brief.md' }]);
  // And it is not one of the two sides: drift still takes two cited documents.
  assert.equal(result.flags[0]?.citations.length, 2);
});

test('a wording naming a document the survey never found is discarded as fabricated provenance', () => {
  const surveyed = new Map([['src-docs', new Set(['docs/prd.md', 'docs/strategy.md'])]]);
  const invented: Observation = {
    ...DRIFT,
    wording: { source: 'src-docs', document: 'docs/vendor-brief.md' },
  };
  const result = screenObservations([invented], SOURCES, surveyed);
  assert.equal(result.flags.length, 0);
  assert.match(result.discarded[0]?.reason ?? '', /takes its wording from docs\/vendor-brief\.md/);
});

test('an observation attributing its wording to nothing keeps an empty attribution, not a guess', () => {
  const result = screenObservations([DRIFT], SOURCES);
  assert.deepEqual(result.flags[0]?.wording, []);
});

test('merged restatements union their wording documents rather than keeping the first', () => {
  const first: Observation = { ...DRIFT, wording: { source: 'src-docs', document: 'docs/prd.md' } };
  const restated: Observation = {
    role: 'reviewer',
    claim: 'strategy defers identity work to next year while the PRD promises SSO at launch',
    citations: [
      { source: 'src-docs', document: 'docs/strategy.md' },
      { source: 'src-git', document: 'README.md' },
    ],
    wording: { source: 'src-git', document: 'README.md' },
  };
  const result = screenObservations([first, restated], SOURCES);
  assert.equal(result.flags.length, 1);
  assert.deepEqual(result.flags[0]?.wording, [
    { source: 'src-docs', document: 'docs/prd.md' },
    { source: 'src-git', document: 'README.md' },
  ]);
});
