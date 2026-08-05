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
 *     repeat) and its declared sources (the only legal targets for proposals
 *     and observation citations).
 *   - The challenger is told to refute one delta, not to review it. A
 *     reviewer asked "is this good?" agrees; a challenger asked "why is this
 *     wrong?" has to find something or concede, and the concession is the
 *     adversarial-pass detail the admission gate records.
 */

import type { ContextProducer, DeltaChallenger, ProducedDelta } from '../kernel/context/produce.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';

/** The roles these passes run as. Not catalog domains — they run around them. */
export const PRODUCER_ROLE = 'context-producer';
export const CHALLENGER_ROLE = 'context-challenger';

function numbered(body: string): string {
  return body
    .split('\n')
    .map((line, i) => `L${i + 1}: ${line}`)
    .join('\n');
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
      ? `Declared sources (the only ids you may cite or propose changes to):\n${input.sources
          .map((s) => `- ${s.id} (${s.kind}: ${s.locator})`)
          .join('\n')}`
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
    '- observations: places where two documents you know of contradict each',
    '  other, each {claim, citations: [{source: declared id, document}, ...]}',
    '  citing BOTH sides. An observation you cannot cite will be discarded.',
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
