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

export function supportPrompt(source: SourceDeliverable, claims: readonly ComposedClaim[]): string {
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
    'Reply with JSON only, no prose outside it:',
    '{"unsupported":[<indices>],"detail":"<one sentence on what you found>"}',
  ].join('\n');
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
  return async (source, claims) => {
    const result = await host.invoke({ role: SUPPORT_ROLE, task: supportPrompt(source, claims) });
    const parsed = extractJson(textOf(host, result)) as {
      unsupported?: unknown;
      detail?: unknown;
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
    };
  };
}
