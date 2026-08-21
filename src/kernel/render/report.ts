/**
 * kernel/render/report.ts — where a pass says what it is doing while it is
 * still doing it.
 *
 * Most kernel work returns its answer and the caller words it, which is the
 * right shape and stays the default: the kernel decides, the surface prints.
 * A few passes are long and made of several host calls each, and there the
 * account has to arrive as the work happens rather than after it — a command
 * that prints nothing for six minutes and then everything at once is
 * indistinguishable from one that hung. Those passes take one of these and the
 * caller supplies its own streams, so nothing in the kernel reaches for
 * process.stdout itself and a test can read back exactly what a run said.
 */
export interface Report {
  /** The account: what happened, in the order it happened. */
  readonly say: (text: string) => void;
  /** What did not happen, and why. */
  readonly warn: (text: string) => void;
}
