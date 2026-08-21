/**
 * kernel/run/ask.ts — a question asked of the staff, answered by one of them.
 *
 * The spine's normal shape is an outcome: something the user wants to happen,
 * which pulls in every concern it implicates and pays for each. A question is
 * not that. "What does our roadmap say about the billing migration?" wants an
 * answer with its sources, from whoever owns the concern it touches — not four
 * roles, four deliverables, a stance from each, and a decision framed out of
 * their disagreement. Paying the fan-out for it is the wrong weight, and the
 * user learns to stop asking.
 *
 * So an ask is a run whose plan has one step. Everything else is the same spine:
 * the same catalog, the same namer choosing who answers, the same declared
 * sources read at work time, the same work log, the same citation discipline.
 * What it drops is what only makes sense with more than one role in the room —
 * the stance protocol and the conflict framing built on it — and what it keeps
 * of the challenge set is the one that is about the answer itself: every
 * load-bearing claim carries a citation or an [unverified] tag.
 *
 * The behavioral rule the whole product rests on holds here too: the user never
 * types a role name. They ask a question; the catalog decides who is qualified
 * to answer it.
 */

import type { Implication } from '../implication/map.ts';
import type { InferredBy } from '../implication/naming.ts';
import { riskTierFor } from '../lessons/admission.ts';
import type { Brief } from '../brief/schema.ts';
import type { DeliverableTemplate } from '../plan/schema.ts';

/**
 * The challenge an answer owes. A question's deliverable makes claims and cites
 * them or it does not; that is checkable and it is the whole of what a single
 * grounded reply can be held to. `scope-diff` is deliberately absent — it asks
 * what the brief requested that the deliverable does not cover, which is a
 * question about a work product's completeness against a template, not about
 * whether an answer answered.
 */
export const ASK_CHALLENGES: readonly string[] = ['claims-cited'];

/**
 * The shape of an answer.
 *
 * Slots rather than prose for the same reason every other deliverable has them:
 * an empty slot is a visible gap rather than a silence the reader has to
 * notice. `limits` is required because the most useful thing an answer can say
 * is what it could not see — a question answered from three of five declared
 * sources is a different answer from one that read all five, and only the
 * deliverable itself can say which this was.
 */
export const ANSWER_TEMPLATE: DeliverableTemplate = {
  deliverable: 'answer',
  // An answer is prose. This template is never dispatched through the work
  // product directive — an ask gets the answer directive below instead — and it
  // declares its form anyway, so that every template in the system says what
  // shape it wants rather than most of them.
  form: 'prose',
  slots: [
    { name: 'answer', expects: 'the answer to the question, stated first, in plain language', required: true },
    {
      name: 'evidence',
      expects: 'what the answer rests on, each item citing a document you actually read, or marked [unverified]',
      required: true,
    },
    {
      name: 'limits',
      expects: 'what you could not see, and what the answer would change to if it turned out otherwise',
      required: true,
    },
    {
      name: 'open-questions',
      expects: 'what remains unknown, each with the assumed default this answer proceeds on',
      required: false,
    },
  ],
};

/**
 * What the role is asked to produce, in place of the work-product directive.
 *
 * The instruction that earns its place here is the last one: a question whose
 * answer is "the material does not say" is answered, not failed. Without it the
 * shape of every other deliverable in this system — issues, findings, steps to
 * resolve — pulls a role into manufacturing a work product out of a question it
 * cannot source, and an invented answer is worse than an absent one.
 */
export function answerDirective(): string {
  const slots = ANSWER_TEMPLATE.slots
    .map((s) => `- ${s.name}${s.required ? '' : ' (optional)'}: ${s.expects}`)
    .join('\n');
  return (
    'You are answering a question, not producing a work product. Structure the ' +
    'answer under exactly these headed sections:\n' +
    `${slots}\n\n` +
    'Rules for the answer:\n' +
    '- Answer the question that was asked. Do not widen it into a review of ' +
    'everything nearby.\n' +
    '- Every load-bearing claim carries a citation to something you read, or an ' +
    '[unverified] tag. A claim you cannot source is still worth stating — ' +
    'tagged, so the reader knows which parts to check.\n' +
    '- "The material does not answer this" is a complete answer when it is the ' +
    'true one. Say what the material does establish, and what would settle the ' +
    'rest.\n' +
    '- Keep it as short as the question allows. A question does not earn a memo.\n\n'
  );
}

/**
 * Which single concern answers this question.
 *
 * The namer returns its implications in its own order and the keyword map in
 * score order, so in both cases the first is the strongest — but a question
 * touching a high-tier concern is routed there over a stronger low-tier one.
 * A privacy question that also reads as product scoping is answered by privacy:
 * the concern with a licensed-review obligation is the one whose absence from
 * the answer would matter, and picking the merely-stronger signal would silently
 * drop it.
 */
export function primaryImplication(
  implicated: readonly Implication[],
): Implication | null {
  if (implicated.length === 0) return null;
  const high = implicated.find((i) => riskTierFor(i.domain) === 'high');
  return high ?? implicated[0];
}

/** Deterministic, and distinguishable from an outcome run's task ids at a glance. */
export function askTaskId(runId: string, domain: string): string {
  return `${runId}:ask:${domain}`;
}

export interface AskBriefInput {
  readonly runId: string;
  /** The question, in the user's words. */
  readonly question: string;
  readonly implication: Implication;
  readonly inferredBy: InferredBy;
}

/**
 * The brief for the one role that answers.
 *
 * `outcome` carries the question because that is the field the whole spine
 * reads — the assignment, the scope-diff record, the log — and giving the
 * question a second home under a different name would mean every reader had to
 * know which of two fields held the user's words. `question` is what marks the
 * dispatch as an ask: present means the deliverable is an answer, and the
 * assignment builder speaks the answer directive and drops the protocols that
 * only mean something with a second role present.
 */
export function askBriefFor(input: AskBriefInput): Brief {
  return {
    id: askTaskId(input.runId, input.implication.domain),
    outcome: input.question,
    question: input.question,
    role: input.implication.domain,
    inputs: [
      { name: 'question', description: "the question, in the user's words", required: true },
    ],
    capabilities: [],
    postconditions: [],
    challenges: [...ASK_CHALLENGES],
    ...(input.implication.signals.length > 0
      ? {
          engagement: {
            concern: input.implication.concern,
            evidence: input.implication.signals,
            inferredBy: input.inferredBy,
          },
        }
      : {}),
  };
}

/**
 * What a user must be told before reading an answer from a high-tier concern.
 *
 * A question routed to privacy, contracts, employment, or compliance gets one
 * grounded pass and no licensed review, and the shape of an answer invites more
 * trust than the shape of an issue list does. Silence here would make the
 * lightweight surface the cheapest way to get a legal-flavored answer with none
 * of the qualifications the full run attaches to one.
 */
export function highRiskNotice(domain: string, licensedReview: string | null): string | null {
  if (riskTierFor(domain) !== 'high') return null;
  const review = licensedReview
    ? ` and a licensed ${licensedReview} is who signs off on it`
    : '';
  return (
    `This question lands in ${domain}, which this tool rates high risk${review}. ` +
    'What follows is one pass over your declared sources, not a review: it can ' +
    'tell you what your own material says and it cannot tell you whether that ' +
    'is enough.\n' +
    `For the full treatment — every implicated concern, the challenges, the ` +
    `decision surfaced — record it as an outcome instead:\n` +
    '  construct outcome "<what you want to happen>"'
  );
}
