/**
 * kernel/render/terminal.ts — the terminal boundary: how text Construct did not
 * write reaches an operator's screen.
 *
 * A terminal is an interpreter, not a page. Control bytes in the stream are
 * instructions to it: an ESC-introduced CSI sequence moves the cursor and erases
 * lines already printed, OSC 8 makes any words a link to any address, and a bare
 * carriage return overwrites the line in front of the reader. A model that emits
 * them is not decorating its answer, it is editing Construct's output — and the
 * lines it can reach are exactly the ones this project exists to print: the
 * concern flag under a deliverable, the claim refused as unsupported, the
 * refusal that says a change was not applied. Text that can erase the flag above
 * it makes every honest surface here unreliable at once.
 *
 * THE POSTURE, decided rather than inherited. A single operator on their own
 * machine already trusts the host they configured, so the trust that matters is
 * not the host's: it is the ground. A model's reply is a function of surveyed
 * documents, dropped-in notes, and whatever the host's own tools opened, none of
 * which the operator wrote and any of which can carry an instruction to emit
 * control bytes. So model-derived text is treated the way mainstream tooling
 * already treats untrusted refs and titles — neutralized at the boundary, not
 * trusted because the person downstream is the owner. The trade is accepted in
 * full: a model that deliberately emits a colored line loses the color, and that
 * is the point. Construct owns its own formatting and nothing else may write it.
 *
 * THE RULE. Every C0 and C1 control code (Unicode's own `Cc` category, which is
 * exactly the range a terminal reads as command rather than content) is rendered
 * as its visible escape, so the operator reads what the model actually sent.
 * Newline and tab survive: printed model prose is laid out with them, and a
 * boundary that ate them would make the escaping cost legibility it does not
 * need to cost. Carriage return does not survive — line-overwriting is the
 * cheapest forgery there is, and a document written with CRLF endings printing a
 * visible `\r` per line is a smaller loss than a reply that can rewrite the line
 * above it.
 *
 * WHICH BOUNDARY THIS IS. `escapeForPrompt` in kernel/run/sourcereads.ts guards a
 * different one — text being joined one item per line into a prompt, where a
 * newline forges a line and therefore may not survive. Two boundaries, two
 * rules, two names: neither function is a drop-in for the other, and text
 * crossing both crosses them separately.
 *
 * WHAT NEVER GOES THROUGH HERE. Construct's own strings. Escaping them would be
 * a no-op on today's text and a licence to stop distinguishing tomorrow's; the
 * call to this function at a print site is what marks that interpolation as
 * somebody else's words.
 */

/** The control range, un-flagged so `test` has no lastIndex to carry. */
const CONTROL = /\p{Cc}/u;
/** The same range, `g`-flagged for a replace pass. */
const CONTROL_G = /\p{Cc}/gu;

/**
 * Control codes a printed line is laid out with. They pass through because
 * losing them costs the reader the shape of the text and buys nothing: neither
 * can move the cursor onto ground already written.
 */
const LAYOUT = new Set(['\n', '\t']);

/**
 * Render model-derived text for a terminal. The result carries no byte a
 * terminal reads as a command, at the cost of no longer being the literal text
 * underneath wherever one was there — which is the honest report, because a
 * sequence shown as `\x1b[2K` is what the model sent and the erased line is not.
 */
export function escapeForTerminal(value: string): string {
  if (!CONTROL.test(value)) return value;
  return value.replace(CONTROL_G, (ch) => {
    if (LAYOUT.has(ch)) return ch;
    if (ch === '\r') return '\\r';
    return `\\x${(ch.codePointAt(0) ?? 0).toString(16).padStart(2, '0')}`;
  });
}
