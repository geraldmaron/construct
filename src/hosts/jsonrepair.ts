/**
 * hosts/jsonrepair.ts — one corrective retry for the host-backed JSON seams.
 *
 * The namer and densifier both ask a model for JSON and nothing else, and on
 * small open-weight models the single most common failure is a reply that is
 * almost JSON: a truncated brace, a stray comma, prose wrapped around the
 * object. Falling straight back on the first malformed reply throws away the
 * cheapest repair there is — showing the model its own reply and the exact
 * parse error, and asking once for the corrected object. Measured community
 * practice puts nearly all of the recoverable failures inside that single
 * corrective turn; further retries buy little and cost a model call each, so
 * this module stops at one.
 *
 * What retries and what does not, deliberately:
 *
 *   - Only a PARSE failure retries. A host that errored or returned a non-ok
 *     status has not produced a malformed reply to correct — reprompting it
 *     would just pay twice for the same broken host.
 *   - The retry happens once. A model that cannot produce the object when
 *     handed its own mistake and the parser's complaint is below the format's
 *     capability floor, and the caller's stated fallback is the right answer.
 *   - A repaired reply is reported as repaired. The caller receives `retried`
 *     so the fact can travel to the work log; a silent second model call would
 *     hide both the cost and the fragility it papers over.
 */

import type { HostAdapter } from '../kernel/hosts/interface.ts';

/** A parsed value plus the fact of how many turns it took. */
export interface RepairedReply<T> {
  readonly value: T;
  /** True when the value came from the corrective second turn. */
  readonly retried: boolean;
  /** The first turn's parse failure, present exactly when `retried` is. */
  readonly firstFailure?: string;
}

/**
 * The corrective turn: the original ask, the model's own failed reply, and the
 * parser's complaint. The closing instruction repeats the format constraints
 * because small models weight the end of the prompt heavily, and the failure
 * being corrected is a format failure.
 */
export function repairPrompt(originalPrompt: string, failedReply: string, error: string): string {
  return [
    'Your previous reply could not be parsed.',
    '',
    'The task was:',
    originalPrompt,
    '',
    'You replied:',
    failedReply,
    '',
    `The parser failed with: ${error}`,
    '',
    'Reply again with ONLY the corrected JSON object. No prose, no markdown',
    'fences, no <think> blocks, nothing before or after the object.',
  ].join('\n');
}

function deliverableText(output: unknown): string {
  const text = (output as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('the host returned no text');
  }
  return text;
}

async function invokeText(host: HostAdapter, role: string, task: string): Promise<string> {
  const result = await host.invoke({ role, task });
  if (result.status !== 'ok') {
    throw new Error(`host "${host.name}" returned status ${result.status}`);
  }
  return deliverableText(result.output);
}

/**
 * Invoke the host and parse its reply, with one corrective retry on a parse
 * failure. `parse` throws to signal a malformed reply; any throw from the
 * host itself propagates without a retry.
 */
export async function invokeWithRepair<T>(
  host: HostAdapter,
  role: string,
  prompt: string,
  parse: (text: string) => T,
): Promise<RepairedReply<T>> {
  const first = await invokeText(host, role, prompt);
  let firstFailure: string;
  try {
    return { value: parse(first), retried: false };
  } catch (error) {
    firstFailure = (error as Error)?.message ?? String(error);
  }

  const second = await invokeText(host, role, repairPrompt(prompt, first, firstFailure));
  try {
    return { value: parse(second), retried: true, firstFailure };
  } catch (error) {
    const secondFailure = (error as Error)?.message ?? String(error);
    throw new Error(`${secondFailure} (after one corrective retry; first failure: ${firstFailure})`);
  }
}

/**
 * Drop <think>…</think> blocks before any parsing. Reasoning-tuned open
 * models (qwen3, GLM) emit them even when told not to, and the block's prose
 * routinely contains braces that would win the outermost-object scan.
 */
export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '');
}
