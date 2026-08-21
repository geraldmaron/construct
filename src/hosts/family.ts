/**
 * hosts/family.ts — reading a model family off the adapter that already
 * knows it, never guessing one.
 *
 * `HostAdapter.modelTuning()` already exists for a different purpose (recording
 * whether a dispatch ran best-effort against an untuned model) and already
 * carries exactly the fact this module needs: which family a model belongs
 * to, declared by the host that knows the vendor's own model names, not
 * inferred from a string the kernel or a challenge pass would otherwise have
 * to pattern-match itself. Reusing it here means family identity has exactly
 * one source of truth instead of two that could disagree.
 */

import type { HostAdapter } from '../kernel/hosts/interface.ts';

/**
 * The family of the model an adapter will run, or null when the adapter
 * cannot say. Null is not "no family" — it is "unknown," and every caller
 * of this function must treat an unknown family as unable to prove
 * independence, never as license to assume a match or a mismatch.
 */
export function familyOf(host: HostAdapter): string | null {
  return host.modelTuning?.(host.model ?? undefined)?.family ?? null;
}
