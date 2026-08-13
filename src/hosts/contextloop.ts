/**
 * hosts/contextloop.ts — the host-layer implementations of the kernel's
 * context-loop seams, built the way densifier.ts and namer.ts are: against
 * `HostAdapter` so one implementation serves every conforming host, throwing
 * on every failure path so the caller states the stop.
 *
 * Two model calls, two disciplines:
 *
 *   - The producer reads the note with its lines numbered, because every
 *     conclusion it proposes must cite `note:<id>#L<n>` and a model cannot
 *     cite line numbers it was never shown. It also reads the workspace's
 *     operational lessons (to propose deltas that supersede rather than
 *     repeat) and its declared sources with the documents each was surveyed
 *     to hold — the only legal targets for proposals and observation
 *     citations. Naming the documents is what makes a drift observation an
 *     observation: asked about "documents you know of", a model answers from
 *     recollection, and the screen downstream cannot tell the difference.
 *   - The challenger is told to refute one delta, not to review it. A
 *     reviewer asked "is this good?" agrees; a challenger asked "why is this
 *     wrong?" has to find something or concede, and the concession is the
 *     adversarial-pass detail the admission gate records.
 */

import type {
  ContextProducer,
  DeltaChallenger,
  ProducedDelta,
  ProducerSource,
} from '../kernel/context/produce.ts';
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
    'Emit three lists, each item citing the exact note line it came from as',
    `"note:${input.noteId}#L<n>":`,
    '- deltas: durable facts worth remembering, each {kind: technique|process|domain,',
    '  domain: what it teaches about, body, citation, external: true only if the',
    '  note pastes text from an outside document}.',
    '- proposals: changes to a declared source that the notes justify, each',
    '  {source: a declared source id, change: the change in auditable words,',
    '  justification: the note citation, risk: low|high — low only for routine',
    '  field updates a human would wave through}.',
    '- observations: places where two of the documents listed above contradict',
    '  each other, each {claim, citations: [{source: declared id, document}, ...]}',
    '  citing BOTH sides by the document paths as listed. An observation citing a',
    '  document that is not listed under its source will be discarded — a',
    '  disagreement you remember rather than read is not an observation.',
    '',
    SETTLED_VS_PARKED_RULE,
    '',
    'Empty lists are valid. Do not reach.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"deltas":[],"proposals":[],"observations":[]}',
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
