/**
 * hosts/contextloop.ts — the host-layer implementations of the kernel's
 * context-loop seams, built the way densifier.ts and namer.ts are: against
 * `HostAdapter` so one implementation serves every conforming host, throwing
 * on every failure path so the caller states the stop.
 *
 * Four model calls, four disciplines:
 *
 *   - The producer reads the note with its lines numbered, because every
 *     conclusion it proposes must cite `note:<id>#L<n>` and a model cannot
 *     cite line numbers it was never shown. It also reads the workspace's
 *     operational lessons (to propose deltas that supersede rather than
 *     repeat) and its declared sources with the documents each was surveyed
 *     to hold — the only legal targets for proposals and observation
 *     citations. It also reads the records the workspace keeps, with what
 *     each says now, so a fact about a named subject lands on that subject
 *     instead of in workspace memory. Naming the documents is what makes a
 *     drift observation an observation: asked about "documents you know of",
 *     a model answers from recollection, and the screen downstream cannot
 *     tell the difference.
 *   - The challenger is told to refute one delta, not to review it. A
 *     reviewer asked "is this good?" agrees; a challenger asked "why is this
 *     wrong?" has to find something or concede, and the concession is the
 *     adversarial-pass detail the admission gate records.
 *   - The drift reviewer reads the same surveyed documents the producer is
 *     shown, and is asked only what contradicts. It gets no note, so it is
 *     asked for no deltas and no proposals: both justify themselves by citing
 *     a note line, and a pass with no note cannot cite one.
 *   - The applier carries out one approved outward change with the host's own
 *     tools. Its honest no is made as easy as its yes, because a model that
 *     believes a refusal will disappoint reports a success it did not have,
 *     and nobody goes and makes a change the record says was already made.
 */

import type {
  ContextProducer,
  DeltaChallenger,
  ProducedDelta,
  ProducerRecord,
  ProducerSource,
} from '../kernel/context/produce.ts';
import type { ProposalApplier } from '../kernel/run/apply.ts';
import type { DriftReviewer } from '../kernel/context/review.ts';
import { REVIEWER_ROLE } from '../kernel/context/review.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';

/** The roles these passes run as. Not catalog domains — they run around them. */
export const PRODUCER_ROLE = 'context-producer';
export const CHALLENGER_ROLE = 'context-challenger';

/**
 * A delta may only record what the notes settled. Notes carry two shapes of
 * material that both read like conclusions but are not: something explicitly
 * parked for later, and something raised and left undecided. Writing either
 * up as a delta records an agreement that was never reached, which is
 * fabrication dressed as extraction. This is exported so the scored
 * evaluation script under scripts/ renders it verbatim rather than keeping
 * a copy that could drift from what the product actually asks a model to do.
 */
export const SETTLED_VS_PARKED_RULE = `A delta records what the notes SETTLED, and only that. Notes also carry items that were explicitly parked, deferred to an owner, or raised and left undecided — those are not decisions, and writing one up as a delta records a resolution nobody reached. Where the notes park something or say a question needs an owner, that is not yours to record as decided; leave it out of the deltas entirely. Before writing each delta, point at the words in the note that make it settled; if the words say "parking that", "needs an owner", "not deciding here", or anything of that shape, it is not a delta.`;

function numbered(body: string): string {
  return body
    .split('\n')
    .map((line, i) => `L${i + 1}: ${line}`)
    .join('\n');
}

/**
 * One source, with what the survey found under it. A source nobody could
 * survey says so: the model is told the documents are unknown rather than
 * shown an empty list, because an empty list reads as "this holds nothing"
 * and the screen downstream exempts exactly this case from its document check.
 */
function sourceListing(source: ProducerSource): string {
  const head = `- ${source.id} (${source.kind}: ${source.locator})`;
  if (source.unreachable !== undefined) {
    return `${head}\n    not surveyed (${source.unreachable}) — cite a document here only if you read it yourself`;
  }
  if (source.documents.length === 0) return `${head}\n    surveyed: no documents`;
  return `${head}\n${source.documents.map((d) => `    ${d}`).join('\n')}`;
}

/**
 * One record with what it currently says. The current values are shown so an
 * update supersedes rather than repeats: a model that cannot see the field is
 * already set to Q3 will helpfully set it to Q3 again, and a history full of
 * restatements is a history nobody can read a change out of.
 */
function recordListing(record: ProducerRecord): string {
  const head = `- ${record.id} (${record.kind}: ${record.name})`;
  if (record.fields.length === 0) return `${head}\n    no fields recorded yet`;
  return `${head}\n${record.fields.map((f) => `    ${f.field}: ${f.value}`).join('\n')}`;
}

export function producerPrompt(input: Parameters<ContextProducer>[0]): string {
  return [
    'A person dumped their after-call notes. Below they are shown with line',
    'numbers, alongside what this workspace already remembers and the sources',
    'it has declared. Your job is to extract what should propagate — never to',
    'invent, improve, or conclude beyond their words.',
    '',
    `Notes (note id ${input.noteId}), verbatim, numbered:`,
    numbered(input.noteBody),
    '',
    input.lessons.length > 0
      ? `What this workspace already remembers:\n${input.lessons.map((l) => `- ${l}`).join('\n')}`
      : 'This workspace remembers nothing yet.',
    '',
    input.sources.length > 0
      ? `Declared sources (the only ids you may cite or propose changes to), and the ` +
        `documents each was found to hold:\n${input.sources.map(sourceListing).join('\n')}`
      : 'No sources are declared: propose no outward changes and no drift observations.',
    '',
    input.records.length > 0
      ? `Records this workspace keeps, and what each says now:\n${input.records.map(recordListing).join('\n')}`
      : 'This workspace keeps no records: propose no record updates.',
    '',
    'Emit four lists, each item citing the exact note line it came from as',
    `"note:${input.noteId}#L<n>":`,
    '- deltas: durable facts worth remembering, each {kind: technique|process|domain,',
    '  domain: what it teaches about, body, citation, external: true only if the',
    '  note pastes text from an outside document}.',
    '- proposals: changes to a declared source that the notes justify, each',
    '  {source: a declared source id, change: the change in auditable words,',
    '  justification: the note citation, risk: low|high — low only for routine',
    '  field updates a human would wave through}.',
    '- records: facts the notes settle about one of the records listed above,',
    '  each {record: a listed record id, field: what the fact is about, value:',
    '  what it now says, citation}. A fact about a named subject belongs on its',
    '  record, not in the deltas: "this client decides scope by quarter" is a',
    '  delta, "Acme moved its renewal to Q3" is a record update. Update a field',
    '  only where the notes say something the record does not already say.',
    '- observations: places where two of the documents listed above contradict',
    '  each other, each {claim, citations: [{source: declared id, document}, ...]}',
    '  citing BOTH sides by the document paths as listed. An observation citing a',
    '  document that is not listed under its source will be discarded — a',
    '  disagreement you remember rather than read is not an observation. Add',
    '  {wording: {source, document}} where the claim takes its framing, its terms',
    '  or its conclusion from one document in particular — including a document',
    '  that is neither of the two you cite. Leave it out where the sentence is',
    '  yours rather than a document\'s.',
    '',
    SETTLED_VS_PARKED_RULE,
    '',
    'Empty lists are valid. Do not reach.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"deltas":[],"proposals":[],"records":[],"observations":[]}',
  ].join('\n');
}

export function challengerPrompt(delta: ProducedDelta, citedLine: string): string {
  return [
    'A proposed lesson is about to enter a workspace\'s memory. Your job is to',
    'refute it, not to review it: find the strongest reason it should not be',
    'remembered, or concede that you cannot.',
    '',
    `Proposed lesson (${delta.kind}, about ${delta.domain}):`,
    delta.body,
    '',
    'The note line it cites as its evidence:',
    citedLine,
    '',
    'Refute it if: the cited line does not actually support it; it generalizes',
    'one remark into a standing fact; it restates the line without teaching',
    'anything durable; or it smuggles in a conclusion the line does not carry.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"refuted":<true|false>,"reason":"<one sentence: the refutation, or why it stands>"}',
  ].join('\n');
}

/**
 * The drift review's prompt: the same documents the producer is shown, asked
 * the one question a review exists to answer. No note, so nothing to cite a
 * line of, so nothing but observations is asked for — a review that proposed
 * memory deltas would be proposing conclusions with no evidence behind them.
 *
 * It asks for one thing besides the findings: an account of which listed
 * documents were actually opened. The documents are opened with the host's own
 * tools and their content never passes through Construct, so without that
 * account a reply of no findings over unopened ground is byte-identical to a
 * reply of no findings over ground read end to end. The account is the model's
 * own word and proves nothing by itself; its absence proves plenty.
 */
export function reviewerPrompt(input: Parameters<DriftReviewer>[0]): string {
  return [
    'You are reading a set of documents a workspace has declared as its ground,',
    'to find where two of them contradict each other. Not to summarize them, not',
    'to improve them, and not to report what you think of them.',
    '',
    'Declared sources and the documents each was found to hold:',
    input.sources.map(sourceListing).join('\n'),
    '',
    'Open the documents and read them. A contradiction is two documents making',
    'claims that cannot both be acted on: a requirement one promises and the',
    'other rules out, a date, an owner, a number, a decision recorded as settled',
    'in one and open in the other. A difference in emphasis is not a',
    'contradiction, and neither is one document being older than another unless',
    'both are presented as current.',
    '',
    'Cite BOTH sides of every contradiction by the document paths as listed',
    'above. An observation citing a document that is not listed will be',
    'discarded, and so will one that cites only one side — a disagreement you',
    'remember rather than read is not an observation.',
    '',
    'Say where each claim\'s own wording came from. Where the sentence you write',
    'takes its framing, its terms or its conclusion from one document in',
    'particular, name that document as "wording" — including where it is neither',
    'of the two documents you cite, which is the case worth naming: the citations',
    'say which documents disagree and can never say which one you are echoing.',
    'Where the sentence is yours, drawn from both sides, leave it out.',
    '',
    'Account for your reading as well as your findings. Name every document',
    'above that you actually opened, and every one you tried to open and could',
    'not, with the error you got back. A document you never opened belongs in',
    'neither list. Say this accurately even where it is unflattering: reporting',
    'that you opened nothing costs you nothing and is the answer that gets the',
    'reads fixed, while a review whose reading cannot be accounted for is thrown',
    'out whatever it found.',
    '',
    'An empty list of findings is a valid answer, and a better one than a reach —',
    'alongside an account of what you opened to reach it.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"read":["<path you opened, exactly as listed above>"],' +
      '"unreadable":[{"document":"<path>","reason":"<the error you got>"}],' +
      '"observations":[{"claim":"<what disagrees, in one sentence>",' +
      '"citations":[{"source":"<declared id>","document":"<path as listed>"},…],' +
      '"wording":{"source":"<declared id>","document":"<path as listed>"}}]}',
  ].join('\n');
}

/** Pull the JSON object out of a reply, tolerating fenced-code wrappers. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('the host replied with no JSON object');
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('the host replied with malformed JSON');
  }
}

function deliverableText(host: HostAdapter, result: { status: string; output: unknown }): string {
  if (result.status !== 'ok') {
    throw new Error(`host "${host.name}" returned status ${result.status}`);
  }
  const text = (result.output as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('the host returned no text');
  }
  return text;
}

/** Build a `ContextProducer` backed by a host adapter; caller owns init(). */
export function createHostProducer(host: HostAdapter): ContextProducer {
  return async (input) => {
    const result = await host.invoke({ role: PRODUCER_ROLE, task: producerPrompt(input) });
    return extractJson(deliverableText(host, result));
  };
}

/** Build a `DriftReviewer` backed by a host adapter; caller owns init(). */
export function createHostReviewer(host: HostAdapter): DriftReviewer {
  return async (input) => {
    const result = await host.invoke({ role: REVIEWER_ROLE, task: reviewerPrompt(input) });
    return extractJson(deliverableText(host, result));
  };
}

/** Build a `DeltaChallenger` backed by a host adapter; caller owns init(). */
export function createHostChallenger(host: HostAdapter): DeltaChallenger {
  return async (delta, citedLine) => {
    const result = await host.invoke({ role: CHALLENGER_ROLE, task: challengerPrompt(delta, citedLine) });
    const parsed = extractJson(deliverableText(host, result)) as {
      refuted?: unknown;
      reason?: unknown;
    } | null;
    if (typeof parsed?.refuted !== 'boolean') {
      throw new Error('the challenger replied without a boolean "refuted"');
    }
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : null;
    if (!reason) {
      // A verdict with no reason is not an adversarial pass anyone can audit.
      throw new Error('the challenger replied without a reason');
    }
    return { upheld: !parsed.refuted, detail: reason };
  };
}

/** The role an apply pass runs as. Not a catalog domain — it runs around them. */
export const APPLIER_ROLE = 'change-applier';

/**
 * The prompt that carries out one approved change.
 *
 * The change is quoted rather than paraphrased: a model asked to restate an
 * instruction before following it follows the restatement, and the human
 * approved these words. The honest no is made as easy as the yes, because a
 * model that believes a refusal will disappoint will report a success it did
 * not have, and a falsely recorded apply is worse than no apply at all —
 * nobody goes and makes the change that the record says was already made.
 */
export function applierPrompt(proposal: {
  readonly source: string;
  readonly locator: string;
  readonly change: string;
  readonly justification: string;
}): string {
  return [
    'A person has approved one change to a system outside this tool, and you are',
    'being asked to carry it out with your own tools. Only this change.',
    '',
    `The system: ${proposal.source} (${proposal.locator})`,
    'The change, in the words it was approved in:',
    proposal.change,
    `Why it was approved: ${proposal.justification}`,
    '',
    'Make exactly that change and nothing adjacent to it. Do not fix anything',
    'else you notice, do not tidy, do not update a second field because it looked',
    'wrong. What was approved is what was approved.',
    '',
    'If you have no way to reach that system, say so plainly and set applied to',
    'false. That is the right answer and it costs nothing: the change stays with',
    'the person who approved it, who can make it themselves. Reporting a change',
    'you did not make is far worse than reporting that you could not — nobody',
    'goes and makes a change the record already says was made.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"applied":<true|false>,"detail":"<what you changed and where, or why you could not>"}',
  ].join('\n');
}

/**
 * Build a `ProposalApplier` backed by a host adapter; caller owns init().
 *
 * A reply missing its boolean throws rather than defaulting either way: a
 * default of true records an apply nobody witnessed, and a default of false
 * would silently discard a change that may have landed.
 */
export function createHostApplier(host: HostAdapter, locatorFor: (source: string) => string): ProposalApplier {
  return async (proposal) => {
    const result = await host.invoke({
      role: APPLIER_ROLE,
      task: applierPrompt({
        source: proposal.source,
        locator: locatorFor(proposal.source),
        change: proposal.change,
        justification: proposal.justification,
      }),
    });
    const parsed = extractJson(deliverableText(host, result)) as {
      applied?: unknown;
      detail?: unknown;
    } | null;
    if (typeof parsed?.applied !== 'boolean') {
      throw new Error('the applier replied without a boolean "applied"');
    }
    return {
      applied: parsed.applied,
      detail: typeof parsed.detail === 'string' ? parsed.detail : '',
    };
  };
}
