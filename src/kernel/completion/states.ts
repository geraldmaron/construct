/**
 * kernel/completion/states.ts — the single ordered completion-state vocabulary.
 *
 * Ported from the predecessor's completion-state list; the exact v2 source
 * path is cited in scripts/capture-legacy-kernel-golden.mjs, which is what
 * locks this port to v2's behavior. The order IS
 * the ladder: a deliverable carries the highest rung for which it holds
 * re-verifiable evidence. In v2 this array had to be kept byte-identical to a
 * JSON schema enum by a parity test; here the array is the single source and
 * COMPLETION_STATES[number] is the type, so drift is a compile error instead of
 * a test failure.
 *
 * This ladder is production evidence and nothing else. Whether anyone may rely
 * on a deliverable is a separate axis — `draft -> challenged -> final`, in
 * completion/promotion.ts, which carries the written decision about why the two
 * are not mapped onto each other.
 */

export const COMPLETION_STATES = [
  'planned',
  'authored',
  'structurally-valid',
  'source-linted',
  'exported',
  'file-valid',
  'renderable',
  'screenshot-captured',
  'visually-reviewed',
  'accessibility-reviewed',
  'approved',
  'completed',
] as const;

export type CompletionState = (typeof COMPLETION_STATES)[number];

export function isCompletionState(state: unknown): state is CompletionState {
  return typeof state === 'string' && (COMPLETION_STATES as readonly string[]).includes(state);
}

/**
 * Rank is the ladder position; -1 for an unknown state. Lets callers compare
 * progression (a later rung requires every earlier rung's evidence) without
 * hardcoding the order.
 */
export function completionRank(state: string): number {
  return (COMPLETION_STATES as readonly string[]).indexOf(state);
}
