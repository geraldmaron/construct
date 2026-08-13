/**
 * hosts/compose.ts — the model calls behind composition.
 *
 * Two passes, and the second exists because the first is the one place in this
 * system where a model is handed finished, challenged work and asked to
 * produce a document from it. That is exactly the position from which adding
 * one plausible sentence is easiest and least visible: it will sit among
 * claims that were checked, in the same voice, and read as though it were.
 *
 * So the composer is told, in the only terms a model reliably acts on, that
 * arranging is the whole job — and then a second pass shows each role its own
 * deliverable beside the claims drawn from it and asks which it does not
 * support. Asking the question that way round matters: "verify these claims"
 * invites agreement, and "which of these does this document not support"
 * invites the model to find something, which is the same reasoning the delta
 * challenger is built on.
 */

import type { HostAdapter } from '../kernel/hosts/interface.ts';
import type { ComposedClaim, SourceDeliverable, SupportChecker } from '../kernel/run/compose.ts';
import type { ConstructPosition, SharedObjection } from '../kernel/run/position.ts';
import type { GapCloser } from '../kernel/run/closing.ts';
import type { CompositionShape } from '../kernel/run/shapes.ts';
import { toClosingReply } from '../kernel/run/closing.ts';
import { extractJson } from './contextloop.ts';

export const COMPOSER_ROLE = 'composer';
export const SUPPORT_ROLE = 'composition-support';

export function composerPrompt(input: {
  readonly outcome: string;
  readonly sources: readonly SourceDeliverable[];
  /**
   * The sections this document carries, chosen from the ask before the composer
   * saw anything. Named rather than fixed so a decision ask does not come back
   * in the shape of a review — and passed in rather than picked here, because a
   * composer choosing its own headings is choosing what the document argues.
   */
  readonly shape: CompositionShape;
}): string {
  return [
    'Several specialists were each asked about one concern of the same outcome.',
    'They have finished, their work has been checked, and each of them was right',
    'to answer only their own concern. Your job is to arrange what they said into',
    'one document a reader can act on.',
    '',
    'Arranging is the ENTIRE job. You may not add a claim, resolve a question',
    'they left open, decide something none of them decided, or fill a gap with',
    'what you happen to know. If the answer to some part of the outcome is not in',
    'the deliverables below, that part is unanswered, and saying so is worth more',
    'than covering it — a reader who is told a gap exists can go and close it,',
    'and a reader who is handed a plausible sentence instead cannot.',
    '',
    `The outcome that was asked:\n${input.outcome}`,
    '',
    ...input.sources.map((source) => `--- ${source.role} ---\n${source.text}`),
    '',
    'Every claim you write names the role whose deliverable it came from. A claim',
    'drawn from two roles is two claims, one per role, rather than one claim that',
    'names both — because each is checked against that role and no other.',
    '',
    `Sections, in this order. A section the deliverables cannot fill is left`,
    'empty rather than filled — the same rule as everything else here, and the',
    'reader is shown which came back empty:',
    ...input.shape.sections.map((s) => `- ${s.name}: ${s.expects}`),
    '',
    'And separately, `uncovered`: the parts of the outcome above that no',
    'deliverable answered. This is not a formality. Read the outcome again,',
    'clause by clause, and list what nobody addressed. An empty list is a real',
    'answer, and a wrong one is the most expensive mistake you can make here.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"claims":[{"section":"<one of the section names>","text":"<the claim>",' +
      '"from":"<the role>"}],"uncovered":["<what nobody answered>"]}',
  ].join('\n');
}

/**
 * The narrow question a role can answer about Construct's call, asked in one
 * place because it is asked twice: once riding the support check that already
 * runs, and again when a call that was sent back comes home. Two wordings of it
 * would be two different questions and only one of them would be the veto.
 */
const POSITION_CHECK: readonly string[] = [
  'You are not being asked whether you agree with the call. It is a judgment',
  'across concerns and yours was one of them; Construct is entitled to make it',
  'and you were not asked for it. What you are asked is narrower and only you',
  'can answer it: does it state your work as something other than what you',
  'established — firmer than you put it, resolved where you left it open, or',
  'resting on you for something you did not say? Quote the sentence if so.',
];

export function supportPrompt(
  source: SourceDeliverable,
  claims: readonly ComposedClaim[],
  /**
   * Construct's own call, when there is one. Shown here rather than in a call
   * of its own: the role is already reading its deliverable to answer a
   * question about faithfulness, and asking the second question costs nothing.
   * A synthesis nobody it leans on can object to is not screened.
   */
  position?: string,
): string {
  return [
    `Below is one specialist's finished deliverable, and beneath it a numbered`,
    'list of claims that someone else wrote down as coming from it.',
    '',
    'Your job is to find the ones it does not support. Not to check them off —',
    'to find the ones that are not there. A claim counts as unsupported if the',
    'deliverable does not say it, if it says something weaker and the claim',
    'firmed it up, if it raised it as a question and the claim answers it, or if',
    'it is true of the world but simply absent from this document.',
    '',
    `--- ${source.role}'s deliverable ---`,
    source.text,
    '',
    '--- claims attributed to it ---',
    ...claims.map((claim, i) => `${String(i)}. [${claim.section}] ${claim.text}`),
    '',
    'Report the indices of the unsupported ones. Finding none is a legitimate',
    'answer; so is finding all of them. Do not stretch to find something, and do',
    'not let a claim pass because it sounds like something this specialist would',
    'have said.',
    '',
    ...(position === undefined
      ? []
      : [
          '',
          '--- and separately: the call Construct made across every specialist ---',
          position,
          '',
          ...POSITION_CHECK,
        ]),
    '',
    'Reply with JSON only, no prose outside it:',
    '{"unsupported":[<indices>],"detail":"<one sentence on what you found>"' +
      (position === undefined ? '}' : ',"misreadsMe":"<the sentence, or empty if none>"}'),
  ].join('\n');
}

export const POSITION_ROLE = 'construct-position';

/**
 * The one question nobody was dispatched for.
 *
 * Every other prompt in this file is written to stop a model adding something.
 * This one is written to make it commit, because the failure it answers is the
 * opposite: a run that assembles five expert readings, arranges them faithfully,
 * and leaves the reader to work out what to do has moved the hardest part of the
 * job to the person who asked for it.
 *
 * The prohibition is kept and narrowed to what it was always about. A fact is
 * something Construct cannot know except through a role that read the ground,
 * and inventing one is fabrication. A judgment is what the facts add up to, and
 * nobody was asked it — each specialist was asked about its own concern and each
 * was right to answer only that. So: no new facts, and a judgment is required.
 */
export function positionPrompt(input: {
  readonly outcome: string;
  readonly sources: readonly SourceDeliverable[];
}): string {
  return [
    'You are Construct. Several specialists have each finished one concern of the',
    'same outcome, their work has been checked, and you are the only participant',
    'who has read all of it. What it adds up to is the question none of them was',
    'asked, and it is yours.',
    '',
    `What was asked:\n${input.outcome}`,
    '',
    ...input.sources.map((source) => `--- ${source.role} ---\n${source.text}`),
    '',
    'Take a position. If the outcome asks what to do, say what to do, in the',
    'shape it asked — a choice if it asked for a choice, an order if it asked',
    'what comes first, a cut if it asked what stops. State it as a commitment',
    'somebody could act on tomorrow, not as a summary of the range of views.',
    '',
    'Two of these specialists agreeing is not a tally to report; it is evidence',
    'about which way the weight falls, and weighing it is your job. Where two of',
    'them cannot both be acted on, decide, and name the reading you did not take',
    'and why. Order of arrival is not a reason. Averaging them into a sentence',
    'neither would recognise is worse than either.',
    '',
    'THE ONE THING YOU MAY NOT DO is assert a fact none of them established.',
    'What the code does, what the schema holds, what a document commits to — you',
    'have no access to any of it except through these deliverables. Every factual',
    'sentence you write names the role or roles whose work it rests on, and a',
    'sentence with nothing behind it is you using what you happen to know about',
    'the world, which is the one thing that is not yours to use here.',
    '',
    'Your reasoning is not a fact and needs no source. That is the whole point of',
    'asking you.',
    '',
    'Then argue against yourself, twice, and mean it. The strongest objection to',
    'your call — the one you find hardest to answer, not one you can dismiss in',
    'the next sentence. And a pre-mortem: assume this was taken and it failed,',
    'and write the most likely story of how. A recommendation shipped without',
    'either is an advertisement.',
    '',
    'If something genuinely cannot be decided from what these deliverables hold,',
    'say what specifically would decide it — a document, a number, a person\'s',
    'answer. Naming the options again is not an answer to that, and an empty list',
    'here is the expected result, not a suspicious one.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"approach":"<the call, one or two sentences, as a commitment>",',
    ' "because":[{"text":"<what it rests on>","restsOn":["<role>"]}],',
    ' "resolved":[{"question":"<what two roles could not both be right about>",',
    '   "took":"<role>","over":"<role>","because":"<why>"}],',
    ' "costs":[{"text":"<what stops, slips, or is displaced>","restsOn":["<role>"]}],',
    ' "first":[{"text":"<what happens first, and what must hold before the next>","restsOn":["<role>"]}],',
    ' "strongestObjection":"<the best argument against this call>",',
    ' "preMortem":"<assume it failed: the most likely story of how>",',
    ' "undecided":[{"question":"<what could not be decided>","settledBy":"<what would settle it>"}]}',
  ].join('\n');
}

export function createHostPositioner(
  host: HostAdapter,
): (input: { outcome: string; sources: readonly SourceDeliverable[] }) => Promise<unknown> {
  return async (input) => {
    const result = await host.invoke({ role: POSITION_ROLE, task: positionPrompt(input) });
    return extractJson(textOf(host, result));
  };
}

/**
 * The call sent back to itself, once, with what the roles it leans on said
 * about it.
 *
 * A role's objection here is not a difference of opinion about the call — it is
 * a role quoting one sentence and saying that sentence states its work as
 * something it did not establish. That is repairable in a single pass, and
 * reporting it instead hands the reader a call plus a correction to apply
 * themselves, which is the position the repair round exists to keep anyone out
 * of.
 *
 * The whole position goes back out with the request, for the reason the
 * deliverable does: this is a fresh dispatch and a fresh dispatch remembers
 * nothing, and a model asked to fix a document it cannot see rebuilds it from
 * the complaints and drops everything nobody complained about. The refusal to
 * take a second attempt that lost ground stands behind the instruction anyway,
 * because an instruction is not a mechanism.
 */
export function positionRepairPrompt(input: {
  readonly outcome: string;
  readonly sources: readonly SourceDeliverable[];
  readonly position: ConstructPosition;
  readonly objections: readonly SharedObjection[];
}): string {
  return [
    'You are Construct. You took a position across every specialist on this',
    'outcome, and each of them was then shown the call beside their own finished',
    'work and asked one question: does it state their work as something other',
    'than what they established? These are the ones who said it does. They are',
    'not disputing your judgment — that is yours and they were not asked for it.',
    'Each is telling you something only they can tell you, about their own',
    'deliverable.',
    '',
    ...input.objections.map(
      (objection) => `- ${objection.roles.join(', ')}: "${objection.quote}"`,
    ),
    '',
    `What was asked:\n${input.outcome}`,
    '',
    ...input.sources.map((source) => `--- ${source.role} ---\n${source.text}`),
    '',
    '--- the call you made, in full ---',
    JSON.stringify(input.position, null, 2),
    '',
    'Send the whole call back, every field it already had, changed where these',
    'objections landed. Do not rewrite it from scratch and do not drop a part',
    'nobody objected to: a second attempt that answers one objection and loses',
    'ground elsewhere is refused, and what the reader then receives is the call',
    'exactly as it stands above, with these objections printed beside it.',
    '',
    'Do not close an objection by deleting the sentence and saying less, by',
    'softening the call into a summary of what the specialists think, or by',
    'moving the contested part into what could not be decided. Each of those',
    'passes the check and costs the reader the answer. If the objection is that',
    'you stated as settled something that role framed as an open question, then',
    'it is open, and the honest repair says so and says what would settle it. If',
    'it is that you used a term the deliverable never used, use theirs.',
    '',
    'You may still take a position and you are still required to. And the one',
    'thing you may not do has not changed: no fact none of them established.',
    'Every factual sentence names the role or roles whose work it rests on, and',
    'one that names nobody is dropped before anyone reads it.',
    '',
    'This is the only time it comes back.',
    '',
    'Reply with JSON only, in the same shape you replied in before, no prose',
    'outside it.',
  ].join('\n');
}

export function createHostPositionRepairer(
  host: HostAdapter,
): (input: {
  outcome: string;
  sources: readonly SourceDeliverable[];
  position: ConstructPosition;
  objections: readonly SharedObjection[];
}) => Promise<unknown> {
  return async (input) => {
    const result = await host.invoke({ role: POSITION_ROLE, task: positionRepairPrompt(input) });
    return extractJson(textOf(host, result));
  };
}

/**
 * The same veto, asked again about the call that came back.
 *
 * On its own rather than riding the support check this time, because the claims
 * drawn from this role did not change and re-verdicting them would spend a call
 * to re-answer a question already answered. Only the roles that objected are
 * asked: a role that had nothing to say about the first call is not owed a
 * second reading of a document edited to answer somebody else.
 */
export function objectionPrompt(source: SourceDeliverable, position: string): string {
  return [
    `Below is one specialist's finished deliverable, and beneath it the call`,
    'Construct made across every specialist. You raised an objection to an',
    'earlier version of this call; this is what came back.',
    '',
    `--- ${source.role}'s deliverable ---`,
    source.text,
    '',
    '--- the call Construct made across every specialist ---',
    position,
    '',
    ...POSITION_CHECK,
    '',
    'Reply with JSON only, no prose outside it:',
    '{"misreadsMe":"<the sentence, or empty if none>"}',
  ].join('\n');
}

export function createHostObjectionChecker(
  host: HostAdapter,
): (source: SourceDeliverable, position: string) => Promise<string> {
  return async (source, position) => {
    const result = await host.invoke({
      role: SUPPORT_ROLE,
      task: objectionPrompt(source, position),
    });
    const parsed = extractJson(textOf(host, result)) as { misreadsMe?: unknown } | null;
    return typeof parsed?.misreadsMe === 'string' ? parsed.misreadsMe.trim() : '';
  };
}

export const CLOSING_ROLE_SUFFIX = '-closing';

/**
 * One role, the gaps the composition found, and the question of which its own
 * material settles.
 *
 * The framing is deliberately not "answer these". A role asked to answer a list
 * answers all of it, from whatever it has, and the run gets a document whose
 * gaps were papered rather than closed. It is asked instead which of them its
 * material settles — a question whose honest answer is often none, and the
 * prompt says so in as many words, because a closing round that cannot come
 * back empty is not a check, it is a generator.
 */
export function closingPrompt(input: {
  readonly outcome: string;
  readonly source: SourceDeliverable;
  readonly gaps: readonly string[];
  readonly groundRoots: readonly string[];
}): string {
  return [
    `You are the ${input.source.role} role. You have already delivered your work on`,
    'this outcome, several other specialists delivered theirs, and the whole was',
    'composed into one document. The composing found questions the document does',
    'not answer, and they are below.',
    '',
    `The outcome:\n${input.outcome}`,
    '',
    '--- your own deliverable ---',
    input.source.text,
    '',
    '--- what the composed document does not answer ---',
    ...input.gaps.map((gap, i) => `${String(i)}. ${gap}`),
    '',
    ...(input.groundRoots.length > 0
      ? [
          'You may read and cite any document under these roots, by its full path:',
          ...input.groundRoots.map((root) => `- ${root}`),
          'If one of these questions is settled by a document you can go and open,',
          'open it and report what it says. That is the entire point of this pass:',
          'the reader has the same list you do and cannot close it any faster.',
          '',
        ]
      : [
          'You have no ground to read beyond your own deliverable on this pass, so',
          'the only questions you can close are ones your delivered work already',
          'settles and the composing missed.',
          '',
        ]),
    'Which of these does YOUR material settle? Not which could you give a',
    'reasonable view on — which does the evidence you hold actually answer.',
    'Closing none of them is a legitimate and common reply, and it is worth far',
    'more than an answer assembled from what you happen to know: the reader is',
    'told the question is open and can go and settle it, and cannot recover from',
    'being handed a plausible sentence instead.',
    '',
    'Quote each gap you report on exactly as it is written above. An answer to a',
    'question that is not on the list is discarded before anyone reads it.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"closed":[{"gap":"<the gap, verbatim>","answer":"<what your material says, ' +
      'citing it>"}],"unclosed":[{"gap":"<the gap, verbatim>","reason":"<what your ' +
      'material would need to hold to settle it, and does not>"}]}',
  ].join('\n');
}

/** Build a gap closer backed by a host adapter; caller owns init(). */
export function createHostGapCloser(host: HostAdapter, outcome: string, groundRoots: readonly string[]): GapCloser {
  return async (source, gaps) => {
    const result = await host.invoke({
      role: `${source.role}${CLOSING_ROLE_SUFFIX}`,
      task: closingPrompt({ outcome, source, gaps, groundRoots }),
    });
    return toClosingReply(extractJson(textOf(host, result)), source.role, gaps);
  };
}

function textOf(host: HostAdapter, result: { status: string; output: unknown }): string {
  if (result.status !== 'ok') {
    throw new Error(`host "${host.name}" returned status ${result.status}`);
  }
  const text = (result.output as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('the host returned no text');
  }
  return text;
}

/** Build a composer backed by a host adapter; caller owns init(). */
export function createHostComposer(
  host: HostAdapter,
): (input: {
  outcome: string;
  sources: readonly SourceDeliverable[];
  shape: CompositionShape;
}) => Promise<unknown> {
  return async (input) => {
    const result = await host.invoke({ role: COMPOSER_ROLE, task: composerPrompt(input) });
    return extractJson(textOf(host, result));
  };
}

/**
 * Build a support checker backed by a host adapter; caller owns init().
 *
 * An index the pass returns that is not a claim it was shown is dropped rather
 * than trusted: a checker that miscounts must not be able to remove a claim it
 * never read.
 */
export function createHostSupportChecker(host: HostAdapter): SupportChecker {
  return async (source, claims, position) => {
    const result = await host.invoke({
      role: SUPPORT_ROLE,
      task: supportPrompt(source, claims, position),
    });
    const parsed = extractJson(textOf(host, result)) as {
      unsupported?: unknown;
      detail?: unknown;
      misreadsMe?: unknown;
    } | null;
    if (!Array.isArray(parsed?.unsupported)) {
      throw new Error('the support check replied without an "unsupported" list');
    }
    const unsupported = parsed.unsupported
      .map((value) => Number(value))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < claims.length);
    return {
      unsupported,
      detail: typeof parsed.detail === 'string' ? parsed.detail.trim() : '',
      misreadsMe: typeof parsed.misreadsMe === 'string' ? parsed.misreadsMe.trim() : undefined,
    };
  };
}
