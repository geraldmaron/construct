/**
 * tests/hosts/compose.test.ts — a challenge or judge pass dispatches
 * cross-family when a second family is genuinely offered, and falls back
 * to same-family with the correlated-error caveat attached when it is not
 * — which is every real call site in this codebase today, since none of
 * them offer a second family yet.
 *
 * And, below those, the prompts themselves: every pass here that writes prose
 * a person will read writes it in Construct's voice, bound before the call
 * rather than checked after it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closingPrompt,
  composerPrompt,
  createHostObjectionChecker,
  createHostSupportChecker,
  positionPrompt,
  positionRepairPrompt,
} from '../../src/hosts/compose.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import type { SourceDeliverable, ComposedClaim } from '../../src/kernel/run/compose.ts';
import { CORRELATED_ERROR_CAVEAT } from '../../src/kernel/challenge/familyroute.ts';
import { HOUSE_VOICE, carriesVoice, constructIdentity } from '../../src/kernel/voice/voice.ts';
import { DEFAULT_SHAPE } from '../../src/kernel/run/shapes.ts';
import type { ConstructPosition } from '../../src/kernel/run/position.ts';

const SOURCE: SourceDeliverable = { role: 'strategy-alignment', text: 'the deliverable text' };
const CLAIM: ComposedClaim = { section: 'the-bet', text: 'a claim', from: 'strategy-alignment', kind: 'bullet' };

/** Answers both the support-check and the objection-check JSON shapes, and records every call it received. */
function trackedHost(
  name: string,
  family: string | null,
  misreadsMe = '',
  unsupported: number[] = [],
  detail = 'the model said so',
): HostAdapter & { calls: number } {
  const host = {
    name,
    kind: 'general',
    capabilities: [],
    calls: 0,
    model: family ?? undefined,
    modelTuning: () => (family === null ? null : { family, tuned: true }),
    init: async () => {},
    invoke: async (): Promise<HostResult> => {
      host.calls += 1;
      return {
        id: name,
        status: 'ok',
        output: { text: JSON.stringify({ misreadsMe, unsupported, detail }) },
        error: null,
      };
    },
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
  };
  return host;
}

test('support check: no other family offered — same-family fallback, caveat attached', async () => {
  const producer = trackedHost('producer', 'claude');
  const check = createHostSupportChecker(producer);
  const verdict = await check(SOURCE, [CLAIM]);
  assert.equal(producer.calls, 1, 'the only adapter offered is the one that ran the check');
  assert.match(verdict.detail, new RegExp(CORRELATED_ERROR_CAVEAT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('support check: a genuinely different family offered — that family answers, no caveat', async () => {
  const producer = trackedHost('producer', 'claude');
  const other = trackedHost('other', 'gpt');
  const check = createHostSupportChecker(producer, [other]);
  const verdict = await check(SOURCE, [CLAIM]);
  assert.equal(producer.calls, 0, 'the producer never answers its own check once a real second family exists');
  assert.equal(other.calls, 1, 'the other family answered instead');
  assert.doesNotMatch(verdict.detail, /upper bound on independent agreement/);
});

test('support check: only the same family offered twice — still falls back, still caveats', async () => {
  const producer = trackedHost('producer', 'claude');
  const sameAgain = trackedHost('same-again', 'claude');
  const check = createHostSupportChecker(producer, [sameAgain]);
  const verdict = await check(SOURCE, [CLAIM]);
  assert.equal(producer.calls, 1);
  assert.equal(sameAgain.calls, 0);
  assert.match(verdict.detail, /upper bound on independent agreement/);
});

test('support check: a clean verdict still carries the caveat when it is same-family', async () => {
  const producer = trackedHost('producer', 'claude', '', [], '');
  const check = createHostSupportChecker(producer);
  const verdict = await check(SOURCE, [CLAIM]);
  assert.deepEqual(verdict.unsupported, []);
  assert.equal(verdict.detail, CORRELATED_ERROR_CAVEAT, 'an empty detail becomes the bare caveat, not a dangling separator');
});

test('objection check: no objection raised — the caveat adds nothing to an empty answer', async () => {
  const producer = trackedHost('producer', 'claude', '');
  const ask = createHostObjectionChecker(producer);
  const quote = await ask(SOURCE, 'the call Construct made');
  assert.equal(quote, '', 'a caveat on "no objection" would manufacture an objection that was never raised');
});

test('objection check: same-family fallback still returns the quote exactly, uncaveated', async () => {
  // Unlike the support check's free-text detail, this return value is
  // presented downstream as the model's own quoted words — deduplicated by
  // exact match and quoted verbatim in the composed document. Appending
  // prose here would misrepresent a direct quotation.
  const producer = trackedHost('producer', 'claude', 'this misreads my finding');
  const ask = createHostObjectionChecker(producer);
  const quote = await ask(SOURCE, 'the call Construct made');
  assert.equal(quote, 'this misreads my finding');
});

test('objection check: a different family offered answers instead, no caveat', async () => {
  const producer = trackedHost('producer', 'claude', 'ignored');
  const other = trackedHost('other', 'gpt', 'this misreads my finding');
  const ask = createHostObjectionChecker(producer, [other]);
  const quote = await ask(SOURCE, 'the call Construct made');
  assert.equal(producer.calls, 0);
  assert.equal(other.calls, 1);
  assert.equal(quote, 'this misreads my finding');
});

/**
 * The three passes that write prose into the composed document — the
 * arrangement, the call, and a role's answer to a gap — used to be the one
 * place in this system where user-visible sentences were produced with no
 * voice bound at all. The role assignments carried it; these did not, and what
 * a reader actually holds is mostly this.
 */
const POSITION: ConstructPosition = {
  approach: 'Ship the pilot in Q4.',
  because: [{ text: 'the blocker is closed', restsOn: ['strategy-alignment'] }],
  resolved: [],
  costs: [],
  first: [],
  strongestObjection: 'The migration may be the real blocker.',
  preMortem: 'It ships, nobody uses it.',
  undecided: [],
};

test('the prompts that write the document write it in one voice, bound before the call', () => {
  const prompts: Record<string, string> = {
    composer: composerPrompt({ outcome: 'Decide the pilot', sources: [SOURCE], shape: DEFAULT_SHAPE }),
    position: positionPrompt({ outcome: 'Decide the pilot', sources: [SOURCE] }),
    closing: closingPrompt({
      outcome: 'Decide the pilot',
      source: SOURCE,
      gaps: ['nobody costed the migration'],
      groundRoots: [],
    }),
    repair: positionRepairPrompt({
      outcome: 'Decide the pilot',
      sources: [SOURCE],
      position: POSITION,
      objections: [{ roles: ['strategy-alignment'], quote: 'the blocker is closed' }],
    }),
  };
  for (const [name, prompt] of Object.entries(prompts)) {
    assert.ok(carriesVoice(prompt), `the ${name} pass writes prose a reader gets: it owes the voice`);
    for (const rule of HOUSE_VOICE) {
      assert.ok(prompt.includes(rule.rule), `the ${name} pass is missing the ${rule.id} rule`);
    }
    // One identity, the same one, however the pass was framed.
    assert.equal(prompt.match(/You are Construct/g)?.length, 1, `${name} declares itself once`);
    // A JSON reply and a voice block in the same prompt is a real collision,
    // and it is answered rather than left for the model to guess at.
    assert.match(prompt, /The reply itself is JSON/);
  }
});

test('a role closing a gap is framed by its concern and still writes as Construct', () => {
  const prompt = closingPrompt({
    outcome: 'Decide the pilot',
    source: SOURCE,
    gaps: ['nobody costed the migration'],
    groundRoots: [],
  });
  assert.ok(prompt.startsWith(constructIdentity({ framedBy: 'strategy-alignment' })));
  assert.ok(!prompt.includes('You are the strategy-alignment role'), 'the framing is not a second author');
});

test('an unknown producer family still falls back and still caveats, even with another family offered', () => {
  return (async () => {
    const producer = trackedHost('producer', null);
    const other = trackedHost('other', 'gpt');
    const check = createHostSupportChecker(producer, [other]);
    const verdict = await check(SOURCE, [CLAIM]);
    assert.equal(producer.calls, 1, 'unknown producer family cannot license a claim that gpt differs from it');
    assert.equal(other.calls, 0);
    assert.match(verdict.detail, /upper bound on independent agreement/);
  })();
});
