/**
 * cli/errors.ts — turning a thrown error into the sentence a person reads.
 *
 * A kernel helper tags a throw with the function that raised it —
 * `resolveDecision: no open decision d1`, `declareSourceEdge: a source does
 * not stand in a relationship to itself` — which orients a developer reading a
 * stack but is noise to the person who typed the command. The surface already
 * prefixes its own verb (`decide: …`, `source: …`), so the internal symbol in
 * front of the sentence only leaks an implementation name. This drops a single
 * leading `<identifier>:` and hands back the plain sentence.
 */

/**
 * An error's message with one leading internal-symbol prefix removed. The
 * prefix is only stripped when it is a bare identifier followed immediately by
 * a colon and a space — so a message that opens with a real word (`UNIQUE
 * constraint failed: …`, a path like `a/b: not found`) is returned whole,
 * because its first token is not an identifier-then-colon.
 */
export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^[A-Za-z_$][\w$]*: /, '');
}
