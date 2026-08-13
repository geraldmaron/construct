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
import { extractJson } from './contextloop.ts';

export const COMPOSER_ROLE = 'composer';
export const SUPPORT_ROLE = 'composition-support';

/**
 * The sections a composed document carries. Fixed rather than free-form so the
 * screen and the reader agree on what was asked for, and so the last one
 * cannot be quietly omitted — a composition missing a third of the ask with no
 * gap named is precisely the failure composing introduces.
 */
export const COMPOSITION_SECTIONS: readonly { readonly name: string; readonly expects: string }[] = [
  { name: 'the-answer', expects: 'what the roles together actually answer, stated first and plainly' },
  { name: 'what-each-concern-established', expects: 'the substance each role contributed, in its own terms' },
  { name: 'where-they-disagree', expects: 'points two deliverables cannot both be acted on, or "none" explicitly' },
  { name: 'what-follows', expects: 'the actions the deliverables together support, only where they say so' },
];

export function composerPrompt(input: {
  readonly outcome: string;
  readonly sources: readonly SourceDeliverable[];
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
    'Sections, in this order:',
    ...COMPOSITION_SECTIONS.map((s) => `- ${s.name}: ${s.expects}`),
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
): (input: { outcome: string; sources: readonly SourceDeliverable[] }) => Promise<unknown> {
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
