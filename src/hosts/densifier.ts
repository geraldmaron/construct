/**
 * hosts/densifier.ts — the host-layer implementation of the kernel's
 * `Densifier` seam, built the same way namer.ts is and for the same reasons:
 * written against `HostAdapter` so one densifier serves every conforming host,
 * and every failure path throws so the caller can state the fallback to the
 * raw text rather than guessing.
 *
 * The prompt's discipline mirrors the corpus it was measured against: real
 * framings carry corrections ("I didnt ask you to use X. i asked you to use
 * Y") where the correction wins, mid-stream constraints ("spend up to 1
 * dollar"), and tangents that must survive as parked items rather than be
 * discarded or promoted into the outcome.
 */

import type { Densifier } from '../kernel/intake/densify.ts';
import { toDensifiedIntake } from '../kernel/intake/densify.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';

/** The role a densifier runs as. Not a catalog domain — it runs before them. */
export const DENSIFIER_ROLE = 'intake-densifier';

export function densifierPrompt(raw: string): string {
  return [
    'A person said what they want to happen, in their own words. The text may',
    'be rough: dictated, nonlinear, carrying corrections and side-thoughts.',
    'Your job is to extract, not to improve their idea.',
    '',
    'Their words, verbatim:',
    raw,
    '',
    'Rules:',
    '- outcome: the primary thing they want to be true, one plain sentence.',
    '- constraints: limits they stated or clearly implied (budget, scope,',
    '  "must not", tools required or refused). Their terms, not yours.',
    '- decisions: choices the text shows as already made. When the text',
    '  corrects itself, the correction is the decision.',
    '- parked: side-thoughts worth keeping that are not this outcome.',
    '- Invent nothing. Every item must be traceable to their words.',
    '- Empty lists are valid. Do not reach.',
    '',
    'Reply with JSON only, no prose outside it:',
    '{"outcome":"<one sentence>","constraints":[],"decisions":[],"parked":[]}',
  ].join('\n');
}

/** Pull the JSON object out of the reply, tolerating fenced-code wrappers. */
export function parseDensified(text: string): ReturnType<typeof toDensifiedIntake> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('the host replied with no JSON object');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error('the host replied with malformed JSON');
  }
  return toDensifiedIntake(parsed);
}

function deliverableText(output: unknown): string {
  const text = (output as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('the host returned no text');
  }
  return text;
}

/** Build a `Densifier` backed by a host adapter; caller owns init(). */
export function createHostDensifier(host: HostAdapter): Densifier {
  return async (raw) => {
    const result = await host.invoke({ role: DENSIFIER_ROLE, task: densifierPrompt(raw) });
    if (result.status !== 'ok') {
      throw new Error(`host "${host.name}" returned status ${result.status}`);
    }
    return parseDensified(deliverableText(result.output));
  };
}
