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
import { chooseChallengeFamily } from '../kernel/challenge/familyroute.ts';
import { escapeForPrompt } from '../kernel/run/sourcereads.ts';
import { extractJson } from './contextloop.ts';
import { familyOf } from './family.ts';

export const COMPOSER_ROLE = 'composer';
export const SUPPORT_ROLE = 'composition-support';
export const SHAPE_ROLE = 'composition-shape';

/**
 * Which document shape an outcome wants — asked of a model, not guessed from
 * its wording.
 *
 * Every other consultation in this codebase already draws this line: outcome
 * inference is keyword matching on the free path and a model call on the paid
 * one (kernel/implication/map.ts vs. hosts/namer.ts), because a model is
 * already being read and paid for the moment a host is named, and guessing
 * from a fixed phrase list when an actual answer is one call away serves
 * nobody. Shape selection had been the one place in compose that kept
 * guessing anyway, on an ask a model is right there to just be asked about —
 * called out directly (Gerald, 2026-08-13) as unacceptable once a fourth
 * shape made the guesswork visible. The keyword chooser in run/shapes.ts does
 * not go away: it is what a run without a host still has, same as domain
 * inference keeps its free path, and it is the disclosed fallback here when
 * the model call itself fails or answers with a name that does not exist.
 */
export function shapeChoicePrompt(outcome: string, shapes: readonly CompositionShape[]): string {
  return [
    'A person asked for something. Which of these document shapes is the ask',
    'actually for? Read the ask as a request for a specific document, not for a',
    'topic — "an RFC deciding X" is asking for the RFC document even though it',
    'also contains a judgment word, because the document type is what the',
    'reader would notice missing if you got this wrong.',
    '',
    ...shapes.map((shape) => `- ${shape.name}: ${shape.answers}`),
    '',
    `The ask:\n${outcome}`,
    '',
    'Reply with JSON only, no prose outside it:',
    `{"shape":"<one of: ${shapes.map((s) => s.name).join(', ')}>"}`,
  ].join('\n');
}

/**
 * Build a shape chooser backed by a host adapter. Returns null on any
 * failure — a bad reply, an unrecognized name, a host that errors — so the
 * caller can fall back to the keyword guess and say so, the same fail-open
 * shape every other host consultation in this file already uses.
 */
export function createHostShapeChooser(
  host: HostAdapter,
): (outcome: string, shapes: readonly CompositionShape[]) => Promise<string | null> {
  return async (outcome, shapes) => {
    try {
      const text = await invokeRetrying(host, {
        role: SHAPE_ROLE,
        task: shapeChoicePrompt(outcome, shapes),
      });
      const parsed = extractJson(text) as { shape?: unknown } | null;
      const name = typeof parsed?.shape === 'string' ? parsed.shape.trim().toLowerCase() : '';
      return shapes.some((shape) => shape.name === name) ? name : null;
    } catch {
      return null;
    }
  };
}

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
    'names both — because each is checked against that role and no other. Name it',
    `exactly as it appears above, between the dashes (e.g. "${input.sources[0]?.role ?? 'product-scoping'}"),`,
    'not a description of it — "Product Scoping" or "the product team" is not a',
    'role this system knows and the claim will be dropped.',
    '',
    `Sections, in this order. A claim's "section" field must be one of these`,
    'names exactly as written below — not a paraphrase, not title case, not',
    `your own heading for it. A section the deliverables cannot fill is left`,
    'empty rather than filled — the same rule as everything else here, and the',
    'reader is shown which came back empty:',
    ...input.shape.sections.map((s) => `- ${s.name}: ${s.expects}`),
    '',
    'Each claim also has a "kind". Most claims are "bullet" — one fact, one',
    'sentence — and that is the right default when in doubt. Reach for the',
    'others only when the deliverables themselves actually have that shape:',
    '',
    '- "paragraph": connected reasoning a reader has to follow in order, not a',
    '  list of independent facts — a deliverable\'s own multi-sentence analysis,',
    '  condensed, not paraphrased into a single line that loses the argument.',
    '- "table": the deliverables compare several items across the same few',
    '  dimensions — options against criteria, sources against status. Never',
    '  build a table with only one row\'s worth of real content; that is a',
    '  bullet wearing a grid.',
    '- "diagram": a deliverable itself describes a flow, sequence, or',
    '  dependency structure. Write valid mermaid source in "text" (e.g.',
    '  "graph TD\\nA[close the gap] --> B[ship the adapter]"). Every node and',
    '  edge must trace to something a deliverable actually said — a diagram is',
    '  the easiest place to imply a relationship nobody established, and the',
    '  same no-adding rule holds here as everywhere else in this job.',
    '',
    'A "table" claim also carries "table": {"headers":[...],"rows":[[...]]}.',
    'Every row must have exactly as many cells as there are headers. "text" on',
    'a table claim is its one-sentence caption, not a cell.',
    '',
    'And separately, `uncovered`: the parts of the outcome above that no',
    'deliverable answered. This is not a formality. Read the outcome again,',
    'clause by clause, and list what nobody addressed. An empty list is a real',
    'answer, and a wrong one is the most expensive mistake you can make here.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"claims":[{"section":"<one of the section names>","kind":"<bullet|paragraph|table|diagram>",' +
      '"text":"<the claim, mermaid source for a diagram, or a table\'s caption>",' +
      '"table":{"headers":["<only for kind=table>"],"rows":[["..."]]},' +
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

/**
 * What one role does and does not support, asked with nothing else in the
 * frame.
 *
 * Construct's call was briefly shown here too, to buy the position's veto for
 * no extra call. Measured on a live composition, that coupling showed itself in
 * the record: a role rejected a claim and gave as its reason that the details
 * "come from the Construct call, not the specialist's work" — a reason it could
 * only give because the call was in front of it. The verdict may well have been
 * right, but it was no longer a verdict about the claim alone, and the
 * dangerous direction is the one that leaves no trace: a plausible synthesis
 * makes the claims under it read as established, and a role anchored that way
 * passes what it would otherwise have caught.
 *
 * The claim screen is the load-bearing one — it is what lets the document say
 * every line in it was checked — so it is the one kept clean. The position's
 * veto is asked separately, by objectionPrompt, at the price of one more call
 * per role.
 */
/**
 * A claim as the checking role needs to see it, not just its caption. A
 * table's real content is its rows — a role asked whether "3 vendors
 * compared" is supported without being shown which three and what the
 * comparison said would be checking the wrong sentence. A diagram's real
 * content is its structure, so the mermaid source goes in verbatim: an
 * edge is a claimed relationship the same as a written sentence is.
 */
function claimAsShownToChecker(claim: ComposedClaim, index: number): string {
  const head = `${String(index)}. [${claim.section}] ${claim.text}`;
  if (claim.kind === 'table' && claim.table) {
    const header = `   | ${claim.table.headers.join(' | ')} |`;
    const rows = claim.table.rows.map((row) => `   | ${row.join(' | ')} |`).join('\n');
    return `${head}\n${header}\n${rows}`;
  }
  if (claim.kind === 'diagram') {
    return `${head}\n   (mermaid source, shown as its own line: ${JSON.stringify(claim.text)})`;
  }
  return head;
}

export function supportPrompt(
  source: SourceDeliverable,
  claims: readonly ComposedClaim[],
): string {
  return [
    `Below is one specialist's finished deliverable, and beneath it a numbered`,
    'list of claims that someone else wrote down as coming from it. A table',
    'claim is shown with its rows, and a diagram claim with its structure — an',
    'invented row or an invented edge is exactly as unsupported as an invented',
    'sentence.',
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
    ...claims.map((claim, i) => claimAsShownToChecker(claim, i)),
    '',
    'Report the indices of the unsupported ones. Finding none is a legitimate',
    'answer; so is finding all of them. Do not stretch to find something, and do',
    'not let a claim pass because it sounds like something this specialist would',
    'have said.',
    '',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"unsupported":[<indices>],"detail":"<one sentence on what you found>"}',
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
    'A side of such a disagreement may hold more than one specialist — three',
    'reaching the same reading against one holding out is the ordinary shape, and',
    'both sides are lists for that reason. Name each specialist exactly as it is',
    'labelled above, one per entry. Put your reasoning in "because", never in the',
    'name: a name with your own gloss attached to it matches no specialist and',
    'the resolution is dropped.',
    '',
    'THE ONE THING YOU MAY NOT DO is assert a fact none of them established.',
    'What the code does, what the schema holds, what a document commits to — you',
    'have no access to any of it except through these deliverables. Every factual',
    'sentence you write names the role or roles whose work it rests on, spelled',
    `exactly as it is labelled above (e.g. "${input.sources[0]?.role ?? 'product-scoping'}"),`,
    'not a description of it — a document name, a team name, or your own role',
    'is never a valid entry here, and a sentence with nothing behind it is you',
    'using what you happen to know about the world, which is the one thing that',
    'is not yours to use here.',
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
    ' "resolved":[{"question":"<what the roles could not both be right about>",',
    '   "took":["<role>"],"over":["<role>"],"because":"<why>"}],',
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
    const text = await invokeRetrying(host, { role: POSITION_ROLE, task: positionPrompt(input) });
    return extractJson(text);
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
    const text = await invokeRetrying(host, { role: POSITION_ROLE, task: positionRepairPrompt(input) });
    return extractJson(text);
  };
}

/**
 * The position's veto: one role, its own deliverable, and Construct's call,
 * with the claims screen deliberately not in the frame (see supportPrompt).
 *
 * Asked twice — once of every role that contributed, and again of the roles
 * that objected, about the call that came back. Only those roles the second
 * time: a role that had nothing to say about the first call is not owed a
 * second reading of a document edited to answer somebody else.
 */
export function objectionPrompt(
  source: SourceDeliverable,
  position: string,
  /** True when this role already objected once and is reading the repair. */
  isRepair = false,
): string {
  return [
    `Below is one specialist's finished deliverable, and beneath it the call`,
    'Construct made across every specialist.',
    ...(isRepair
      ? ['You raised an objection to an earlier version of this call; this is what', 'came back.']
      : []),
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

/**
 * Which adapter actually answers a challenge or judge pass, and the caveat
 * to carry if it falls back to the same family that produced the deliverable
 * under check.
 *
 * `otherFamilyHosts` is every other adapter this caller happens to have on
 * hand — empty for every call site in this codebase today, because a run
 * dispatches through exactly one host and nothing here spawns a second one.
 * Passing none is not a missing feature to route around; it is today's
 * honest state, and the empty list is why the fallback (same family, caveat
 * attached) is what actually runs everywhere right now. The seam exists so
 * that changes the day a caller can genuinely offer a second family, not a
 * day sooner.
 */
function challengeHost(
  host: HostAdapter,
  otherFamilyHosts: readonly HostAdapter[],
): { readonly host: HostAdapter; readonly caveat: string | null } {
  const choice = chooseChallengeFamily({
    producerFamily: familyOf(host),
    availableFamilies: otherFamilyHosts.map((h) => familyOf(h)).filter((f): f is string => f !== null),
  });
  if (choice.sameFamily) return { host, caveat: choice.caveat };
  const chosen = otherFamilyHosts.find((h) => familyOf(h) === choice.family);
  // chosen is always found here: chooseChallengeFamily only names a family
  // that came from this exact list, so its absence would be this function
  // disagreeing with itself, not a real caller state — but the same-family
  // host is what a caller can trust either way, so a fallback to it is safe
  // rather than a thrown surprise over a defect that has nothing to do with
  // the caller's request.
  return chosen ? { host: chosen, caveat: null } : { host, caveat: choice.caveat };
}

export function createHostObjectionChecker(
  host: HostAdapter,
  otherFamilyHosts: readonly HostAdapter[] = [],
): (source: SourceDeliverable, position: string, isRepair?: boolean) => Promise<string> {
  return async (source, position, isRepair = false) => {
    // Cross-family dispatch applies here exactly as it does to the support
    // check; the caveat does not. What this returns is presented downstream
    // as the model's own quoted words — deduplicated across roles by exact
    // text match, and quoted verbatim in the composed document. Appending
    // prose to it would misrepresent a direct quotation as saying something
    // the model did not say, which is a worse defect than an unattached
    // caveat. A same-family fallback here is silent on the page; it is not
    // silent in the record, because the work log entry this checker's
    // caller writes is where a correlated-error qualification belongs.
    const { host: answering } = challengeHost(host, otherFamilyHosts);
    const text = await invokeRetrying(answering, {
      role: SUPPORT_ROLE,
      task: objectionPrompt(source, position, isRepair),
    });
    const parsed = extractJson(text) as { misreadsMe?: unknown } | null;
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
          ...input.groundRoots.map((root) => `- ${escapeForPrompt(root)}`),
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
    const text = await invokeRetrying(host, {
      role: `${source.role}${CLOSING_ROLE_SUFFIX}`,
      task: closingPrompt({ outcome, source, gaps, groundRoots }),
    });
    return toClosingReply(extractJson(text), source.role, gaps);
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
    const text = await invokeRetrying(host, { role: COMPOSER_ROLE, task: composerPrompt(input) });
    return extractJson(text);
  };
}

/**
 * One host call, retried once on any failure before giving up.
 *
 * Measured on a live composition on a free host: a support
 * call returning no text discarded a whole finished document — the composer's
 * call, the position, the position's own screen, and every other role's
 * completed claims check, none of them wrong, all of them thrown away because
 * one call came back empty. That is a flaky-host failure, not a defect in the
 * reply to repair (contrast hosts/jsonrepair.ts, which shows the model its own
 * malformed JSON and asks for the fix); the only thing worth doing differently
 * the second time is asking again. One retry, matching the "one corrective
 * turn" ceiling already set for the JSON seams — a call that fails twice in a
 * row is below the floor a retry can rescue, and the caller's fail-closed
 * fallback is the right answer at that point, not a third attempt.
 */
async function invokeRetrying(
  host: HostAdapter,
  request: Parameters<HostAdapter['invoke']>[0],
): Promise<string> {
  try {
    return textOf(host, await host.invoke(request));
  } catch {
    return textOf(host, await host.invoke(request));
  }
}

/**
 * Build a support checker backed by a host adapter; caller owns init().
 *
 * An index the pass returns that is not a claim it was shown is dropped rather
 * than trusted: a checker that miscounts must not be able to remove a claim it
 * never read.
 */
export function createHostSupportChecker(
  host: HostAdapter,
  otherFamilyHosts: readonly HostAdapter[] = [],
): SupportChecker {
  return async (source, claims) => {
    const { host: answering, caveat } = challengeHost(host, otherFamilyHosts);
    const text = await invokeRetrying(answering, { role: SUPPORT_ROLE, task: supportPrompt(source, claims) });
    const parsed = extractJson(text) as {
      unsupported?: unknown;
      detail?: unknown;
    } | null;
    if (!Array.isArray(parsed?.unsupported)) {
      throw new Error('the support check replied without an "unsupported" list');
    }
    const unsupported = parsed.unsupported
      .map((value) => Number(value))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < claims.length);
    const detail = typeof parsed.detail === 'string' ? parsed.detail.trim() : '';
    return {
      unsupported,
      // The caveat rides the detail field regardless of the verdict — unlike
      // an objection's empty string, "every claim is supported" is still a
      // verdict this checker reached, and a same-family verdict of "clean"
      // deserves the same qualification a same-family "N unsupported" would.
      detail: caveat !== null ? (detail.length > 0 ? `${detail} (${caveat})` : caveat) : detail,
    };
  };
}
