/**
 * tests/kernel/run/closing.test.ts — the round that answers what the
 * composition said nobody answered, and the three things it must not become.
 *
 * It must not answer questions nobody asked, because a gap invented and then
 * closed is an addition wearing the shape of an arrangement. It must not admit
 * an answer that would have failed the checks its author's first deliverable
 * passed, because a document whose credibility rests on everything in it being
 * checked cannot carry one paragraph that is not. And it must not quietly pick
 * between two roles answering the same question — that is a disagreement, and
 * the spine surfaces disagreements rather than resolving them by arrival order
 * and saying nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeGaps,
  foldClosingRound,
  screenClosedAnswers,
  toClosingReply,
} from '../../../src/kernel/run/closing.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const GAPS = [
  'No deliverable determined which auth mode is set in the production deployment.',
  'No deliverable assigned a named owner for closing the reauth gap.',
];

function brief(challenges: readonly string[]): Brief {
  return {
    id: 't-privacy',
    outcome: 'Decide what to commit to over the next two releases',
    role: 'privacy',
    inputs: [],
    capabilities: [],
    postconditions: [],
    challenges,
  };
}

test('an answer to a gap the composition never named is refused before anyone reads it', () => {
  const reply = toClosingReply(
    {
      closed: [
        { gap: GAPS[0], answer: 'It is supabase [cite:docs/data/firebase-wind-down.md].' },
        { gap: 'Whether the mobile app should be rewritten.', answer: 'It should not.' },
      ],
    },
    'privacy',
    GAPS,
  );

  assert.equal(reply.closed.length, 1);
  assert.equal(reply.closed[0]?.gap, GAPS[0]);
  assert.equal(reply.refused.length, 1);
  assert.match(reply.refused[0]?.reason ?? '', /did not name/);
});

test('a gap is matched on its own text, not on something close to it', () => {
  const reply = toClosingReply(
    { closed: [{ gap: 'no deliverable determined WHICH AUTH MODE   is set in the production deployment.', answer: 'supabase [cite:x.md]' }] },
    'privacy',
    GAPS,
  );

  // Whitespace and case only: the gap is the same sentence, so it matches and
  // comes back carrying the composition's own wording rather than the role's.
  assert.equal(reply.closed.length, 1);
  assert.equal(reply.closed[0]?.gap, GAPS[0]);
});

test('an answer that would have failed its own deliverable checks does not enter the document', () => {
  const reply = toClosingReply(
    {
      closed: [
        {
          gap: GAPS[0],
          answer: 'The production deployment has run supabase auth since 2026-07-25 on 100% of traffic.',
        },
      ],
    },
    'privacy',
    GAPS,
  );

  const screened = screenClosedAnswers(reply, brief(['claims-cited']), ['/ground/repo']);

  assert.equal(screened.closed.length, 0);
  assert.equal(screened.refused.length, 1);
  assert.match(screened.refused[0]?.reason ?? '', /claims-cited/);
  assert.match(screened.refused[0]?.reason ?? '', /the gap stands/);
});

test('a cited answer passes the same checks and is admitted', () => {
  const reply = toClosingReply(
    {
      closed: [
        {
          gap: GAPS[0],
          answer: 'ADMIN_AUTH_MODE is supabase [cite:docs/data/firebase-wind-down.md].',
        },
      ],
    },
    'privacy',
    GAPS,
  );

  const screened = screenClosedAnswers(reply, brief(['claims-cited']), ['/ground/repo']);

  assert.equal(screened.closed.length, 1);
  assert.equal(screened.refused.length, 0);
});

test('two roles answering the same gap makes it contested, not answered', () => {
  const first = toClosingReply(
    { closed: [{ gap: GAPS[0], answer: 'supabase [cite:a.md]' }] },
    'privacy',
    GAPS,
  );
  const second = toClosingReply(
    { closed: [{ gap: GAPS[0], answer: 'firebase [cite:b.md]' }] },
    'evidence-provenance',
    GAPS,
  );

  const round = foldClosingRound(GAPS, [first, second]);

  // Neither answer is promoted to "the answer". Both are shown against the
  // question, because a reader who is told supabase and never told a second
  // role said firebase has been handed a disagreement disguised as a fact.
  assert.equal(round.closed.length, 0);
  assert.equal(round.contested.length, 1);
  assert.equal(round.contested[0]?.gap, GAPS[0]);
  assert.deepEqual(
    round.contested[0]?.answers.map((a) => a.role),
    ['privacy', 'evidence-provenance'],
  );
});

test('a gap several roles opened their material for reads differently from one nobody looked at', () => {
  const looked = toClosingReply(
    { unclosed: [{ gap: GAPS[1], reason: 'no document in the material names an owner for it' }] },
    'program-sequencing',
    GAPS,
  );

  const round = foldClosingRound(GAPS, [looked]);
  const withReason = round.standing.find((s) => s.gap === GAPS[1]);
  const untouched = round.standing.find((s) => s.gap === GAPS[0]);

  assert.equal(withReason?.reasons.length, 1);
  assert.match(withReason?.reasons[0]?.reason ?? '', /names an owner/);
  assert.equal(untouched?.reasons.length, 0);
});

test('a round in which nobody closed anything leaves every gap standing', () => {
  const round = foldClosingRound(GAPS, [toClosingReply({}, 'privacy', GAPS)]);

  assert.equal(round.closed.length, 0);
  assert.equal(round.standing.length, GAPS.length);
});

/**
 * The real discard, from a recorded run: an answer thrown out for having no
 * labelled pre-mortem and no scope diff, against a question that asked who owns
 * a tracked gap. The run held the answer, failed it on a heading, and printed
 * "the gap stands" — reporting an absence it had just filled.
 *
 * A closing answer is still screened. What it is screened on is whether it is
 * sourced, which a two-sentence answer can fail honestly, and not whether it
 * has the sections a memo owes.
 */
test('an answer is not discarded for lacking sections only a deliverable owes', () => {
  const reply = {
    closed: [
      {
        gap: 'Ownership of the canonical-write reauth gap is unresolved',
        role: 'privacy',
        answer:
          'decisions-carryover.md names it as a follow-up and assigns no owner ' +
          '[cite:docs/decisions-carryover.md].',
      },
    ],
    unclosed: [],
    refused: [],
  };

  const screened = screenClosedAnswers(
    reply,
    brief(['claims-cited', 'scope-diff', 'pre-mortem', 'strongest-objection']),
    ['/repo'],
  );

  assert.equal(screened.closed.length, 1);
  assert.deepEqual(screened.refused, []);
});

test('an answer that names a document it never opened is still refused', () => {
  const reply = {
    closed: [
      {
        gap: 'Ownership of the canonical-write reauth gap is unresolved',
        role: 'privacy',
        answer: 'The answer is in docs/decisions-carryover.md.',
      },
    ],
    unclosed: [],
    refused: [],
  };

  const screened = screenClosedAnswers(
    reply,
    brief(['claims-cited', 'ground-exhausted', 'pre-mortem']),
    ['/repo'],
  );

  assert.equal(screened.closed.length, 0);
  assert.match(screened.refused[0].reason, /ground-exhausted/);
});

/**
 * The round itself, rather than the pieces it is made of. It is where the
 * fail-soft rule lives: a role that cannot be reached costs the run that
 * role's answers and nothing else, and the reader is told which role went
 * quiet rather than reading a document that is silently one concern short.
 */
test('a role that cannot be asked leaves its gaps standing and is named for it', async () => {
  const said: string[] = [];
  const round = await closeGaps({
    close: async (source, gaps) => {
      if (source.role === 'security') throw new Error('the host returned no text');
      return {
        closed: [{ gap: gaps[0], role: source.role, answer: 'It is supabase [cite:/repo/auth.md].' }],
        unclosed: [],
        refused: [],
      };
    },
    groundRoots: ['/repo'],
    sources: [
      { role: 'privacy', text: 'the privacy deliverable' },
      { role: 'security', text: 'the security deliverable' },
    ],
    briefs: new Map([
      ['privacy', brief(['claims-cited'])],
      ['security', brief(['claims-cited'])],
    ]),
    gaps: GAPS,
    report: { say: (t) => said.push(t), warn: () => undefined },
  });

  assert.equal(round.closed.length, 1, "the reachable role's answer still lands");
  assert.equal(round.closed[0]?.role, 'privacy');
  assert.deepEqual(
    round.standing.map((s) => s.gap),
    [GAPS[1]],
  );
  assert.match(said.join(''), /security could not be asked/);
  assert.match(said.join(''), /2 unanswered question\(s\) back to 2 role\(s\)/);
});

test('a role whose brief could not be read is asked and then not admitted', async () => {
  const round = await closeGaps({
    close: async (source, gaps) => ({
      closed: [{ gap: gaps[0], role: source.role, answer: 'It is supabase [cite:/repo/auth.md].' }],
      unclosed: [],
      refused: [],
    }),
    groundRoots: ['/repo'],
    sources: [{ role: 'privacy', text: 'the privacy deliverable' }],
    briefs: new Map(),
    gaps: GAPS,
    report: { say: () => undefined, warn: () => undefined },
  });

  assert.equal(round.closed.length, 0);
  assert.match(round.refused[0]?.reason ?? '', /brief could not be read/);
});
