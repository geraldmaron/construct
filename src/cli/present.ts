/**
 * cli/present.ts — the lines more than one verb has to print the same way.
 *
 * Two surfaces wording the same fact differently is how a reader comes to
 * believe they are looking at two facts: the waiting-change queue is printed by
 * `decide` and by `propose`, the drift screen by `notes` and by `review`, and
 * the recourse after a run where nothing came back by `work` and by `log`. One
 * writer each, so they cannot drift.
 */

import type { Store } from '../kernel/store/open.ts';
import { getSource } from '../kernel/store/sources.ts';
import type { WriteProposal } from '../kernel/store/sources.ts';
import type { DriftCitation, ScreenResult } from '../kernel/context/observations.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';

export function money(amount: number): string {
  return amount === 0 ? '0' : amount.toFixed(amount < 0.01 ? 5 : 2);
}

/**
 * Why a task failed, in one line. A failed task has no cost to report, and
 * saying "cost not reported" there tells the user nothing about the thing that
 * actually went wrong.
 */
export function failureLine(error: unknown): string {
  const record = error as { messages?: unknown; message?: unknown } | null;
  const first = Array.isArray(record?.messages) ? record.messages[0] : record?.message;
  const message = typeof first === 'string' && first ? first : 'failed';
  // A wall the user cannot move is a wall; naming the flag that moves it is
  // the difference between a limit and a dead end. Said here rather than in
  // the error itself, which belongs to the kernel and knows no flags.
  return /invocation exceeded \d+ms/.test(message)
    ? `${message} — raise it with --timeout=<minutes> (and --lease-minutes past it), or ground the run in fewer documents`
    : message;
}

/**
 * What to say when an attempt to work produced no deliverable at all.
 *
 * An earlier fix established the substance of this and it is unchanged: a failed
 * task is terminal, the host owns retries (commitment 1), and nothing here is a
 * retry policy. What it got wrong was reachability. The text lived only on the
 * nothing-left-to-work path, so it printed on a SECOND `construct work` against
 * an already-settled run — and the output of the first gave nobody a reason to
 * run a second (found in a live run whose every task failed with
 * "Missing Authentication header" and said nothing further).
 *
 * So it is one writer called from both places rather than two copies that drift.
 */
export function writeTotalFailureRecourse(failedCount: number): void {
  process.stdout.write(
    `\nAll ${String(failedCount)} task(s) failed and produced no deliverable.\n` +
      'A failed task is terminal — the host owns retries, so re-running work will not pick these up.\n' +
      'If the cause was the dispatch rather than the work (an unresolvable --model, a host that was ' +
      'not reachable, a missing credential), fix it and file the outcome again:\n' +
      '  construct outcome "<what you want>"\n',
  );
}

export function citationList(citations: readonly DriftCitation[]): string {
  return citations.map((c) => `${c.source} ${c.document}`).join('; ');
}

/**
 * Print what a drift screen kept and what it dropped. One writer because the
 * note loop and the standalone review both end here, and a reader comparing
 * the two surfaces should not have to work out whether they mean the same
 * thing by a flag.
 *
 * Every flag names two provenances, because they answer different questions.
 * The citations say which documents disagree. The wording says which single
 * document the sentence in front of the reader was carried in from, which is
 * routinely neither of them — a claim can be phrased by a third document that
 * the citations will never mention, and printed without that line the reader
 * cannot tell whose words they are reading.
 */
export function writeDrift(screened: ScreenResult): void {
  if (screened.flags.length > 0) {
    process.stdout.write('\ncross-source drift:\n');
    for (const flag of screened.flags) {
      // The quoted words travel with the citation, in full. A reader who can
      // see what the document was said to say can go and check it; one shown a
      // path alone is being asked to take the finding's word for it, and a
      // quotation shortened to fit a line is a document quoted as saying
      // something narrower than it did.
      const cites = flag.citations
        .map((c) => `${escapeForTerminal(c.source)} ${escapeForTerminal(c.document)}${c.quote ? ` "${escapeForTerminal(c.quote.trim())}"` : ''}`)
        .join('; ');
      process.stdout.write(`  ${escapeForTerminal(flag.claim)}\n    cites: ${cites}\n`);
      process.stdout.write(
        flag.wording.length > 0
          ? `    wording from: ${escapeForTerminal(citationList(flag.wording))}\n`
          : '    wording from: not stated — nothing attributes these words to a document\n',
      );
      if (flag.unverifiedSupport !== null) {
        process.stdout.write(`    ${escapeForTerminal(flag.unverifiedSupport)}\n`);
      }
    }
  }
  for (const drop of screened.discarded) {
    process.stdout.write(`  discarded observation: ${escapeForTerminal(drop.observation.claim.slice(0, 60))} — ${escapeForTerminal(drop.reason)}\n`);
  }
}

/**
 * How many lines of one change the queue prints before it says how many more
 * there are. Enough for a redline and its two halves; short enough that a
 * document body does not bury the rows under it.
 */
const CHANGE_LINES = 16;

/**
 * One waiting outward change, written the same way wherever the queue is
 * printed. The decide surface and `propose list` both end here, because two
 * renderings of the same queue would drift into two answers about what waits.
 *
 * A change is as long as the words it proposes: a redline carries the text it
 * would strike and the text that would stand there, so every line of it is
 * indented into the row and a change too long to show says how much was left
 * off. Truncating silently would hand somebody a partial redline to approve
 * with no sign that it was partial.
 */
export function writeProposalRow(store: Store, proposal: WriteProposal, standing: boolean): void {
  const target = getSource(store, proposal.source)?.locator ?? proposal.source;
  process.stdout.write(`  ${proposal.id}  [${proposal.risk} risk]  ${escapeForTerminal(target)}\n`);
  const lines = proposal.change.split('\n');
  for (const line of lines.slice(0, CHANGE_LINES)) {
    process.stdout.write(line === '' ? '\n' : `      ${escapeForTerminal(line)}\n`);
  }
  if (lines.length > CHANGE_LINES) {
    process.stdout.write(
      `      … ${String(lines.length - CHANGE_LINES)} more line(s), not shown here\n`,
    );
  }
  process.stdout.write(`      justified by ${escapeForTerminal(proposal.justification)}\n`);
  process.stdout.write(
    `      ${
      proposal.risk === 'high'
        ? 'waits for you whatever the standing consent says: high risk is never covered by it'
        : standing
          ? 'covered by this workspace standing consent for low-risk changes'
          : 'waits for your decision'
    }\n`,
  );
}
