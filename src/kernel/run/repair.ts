/**
 * kernel/run/repair.ts — the round that sends a deliverable back to the role
 * that wrote it, once, when the free checks say the work is not finished.
 *
 * The structural checks were already running and already right. A recorded run
 * produced five deliverables; every one failed its citation gate and every one
 * failed ground-exhaustion, which is the gate saying in plain words that each
 * role named documents it never opened. Nothing consumed those verdicts. The
 * run composed a document out of all five, disclosed that none had passed, and
 * delivered it.
 *
 * Disclosing a failure is not the same as acting on one. The reader who is told
 * that five deliverables named documents nobody read now holds a document, a
 * list of unread files, and the same license the roles had — which is the
 * position the ground-exhaustion rule exists to keep anyone out of. The work was
 * available, the check found it was not done, and the run's answer was to write
 * that down. A contributor who is told their work is short finishes it.
 *
 * So the failing deliverable goes back to its author with the verdicts that
 * caught it, and what comes back is checked again. The disclosure stays for
 * whatever still fails after that, because a second attempt is a chance to
 * finish, not a guarantee of finishing.
 *
 * Three bounds, each load-bearing:
 *
 *   - ONE ROUND. A repaired deliverable is never repaired again. The same stop
 *     rule the research rung and the closing round carry, for the same reason:
 *     a run that keeps handing its own work back to itself never delivers, and
 *     the second pass is where nearly all of the recoverable work is.
 *   - THE WHOLE DELIVERABLE COMES BACK. Not a patch, not the missing section.
 *     A role that returns only what the checker asked for has written to the
 *     checker rather than to the reader, and the next check would then be run
 *     against a document nobody would receive.
 *   - THE CHEAP FIX IS NAMED AND REFUSED. Every one of these checks has a way
 *     to be satisfied without doing anything: tag the claim [unverified]
 *     instead of sourcing it, write "could not be read" over a file nobody
 *     opened, add the heading and leave it empty. A check that can be passed by
 *     relabelling teaches relabelling. The instruction below says which cheap
 *     fix belongs to which check and forbids it by name, and the record keeps
 *     first attempt and repair apart so a pass bought that way is visible.
 */

import type { StructuralResult } from '../challenge/catalog.ts';

/** A repaired deliverable lands as a new draft; this names the event beside it. */
export const REPAIR_ACTION = 'repair-requested';

/**
 * How a deliverable came to be the one the run holds. Recorded rather than
 * derived, because "passed" and "passed on the second attempt" are different
 * facts about the same document and only one of them is visible in a verdict.
 */
export type DraftAttempt = 'first' | 'repaired';

/**
 * The failures worth sending back.
 *
 * Every failed structural check qualifies. There is no severity ordering here
 * on purpose: the checks are already scoped to the presence of work the brief
 * declared, so a failure is by construction work the role owed and did not
 * show, and a repair round that triaged its own checks would be re-deciding an
 * obligation the brief already settled.
 */
export function repairableFailures(
  results: readonly StructuralResult[],
): readonly StructuralResult[] {
  return results.filter((result) => !result.passed);
}

/**
 * The cheap way to pass each check without doing its work, written so the
 * instruction can forbid the specific one rather than the general habit.
 *
 * Keyed by challenge id, with a prefix match so the rubric challenges — which
 * are namespaced `rubric-<concern>-<line>` — reach their entry without this
 * table having to name every reader line.
 */
const CHEAP_FIX: readonly { readonly prefix: string; readonly refusal: string }[] = [
  {
    prefix: 'claims-cited',
    refusal:
      'Tagging a claim [unverified] when you could have opened the document that ' +
      'settles it. The tag is for a claim nothing in your ground can source, not ' +
      'for one you did not go and check.',
  },
  {
    prefix: 'ground-exhausted',
    refusal:
      'Writing that a document could not be read when you never tried to open it, ' +
      'or deleting the sentence that named it. Both leave the reader worse off than ' +
      'the failure did: one is false, the other hides the gap the check found. Open ' +
      'the file and cite it, or state the error you actually got when you tried.',
  },
  {
    prefix: 'scope-diff',
    refusal:
      'Adding an "out of scope" heading with nothing real beneath it. Name what the ' +
      'brief asked for that this does not cover, in the words the outcome used.',
  },
  {
    prefix: 'pre-mortem',
    refusal:
      'A heading followed by a restatement of the risks you already listed. Assume ' +
      'the recommendation was taken and failed, and write the most likely story of how.',
  },
  {
    prefix: 'strongest-objection',
    refusal:
      'Stating an objection you can dismiss in the next sentence. The one that ' +
      'belongs here is the one you find hardest to answer.',
  },
  {
    prefix: 'rubric-',
    refusal:
      'Prose about the thing the line asks for instead of the thing itself — ' +
      'describing that no owner is named rather than naming one, or saying a ' +
      'measure would be needed rather than giving it.',
  },
];

function cheapFixFor(challenge: string): string | null {
  return CHEAP_FIX.find((entry) => challenge.startsWith(entry.prefix))?.refusal ?? null;
}

export interface RepairRequest {
  readonly role: string;
  /** The deliverable as first submitted, whole. */
  readonly deliverable: string;
  /** What failed, with the detail the checker recorded. */
  readonly failures: readonly StructuralResult[];
  /** The roots this role may still read, if the dispatch was grounded. */
  readonly groundRoots?: readonly string[];
}

/**
 * What the role is told when its deliverable comes back.
 *
 * Written as a finishing instruction rather than a correction notice. The
 * distinction matters to what comes back: a role told it made mistakes edits
 * the sentences the checker pointed at, and a role told its work is not
 * finished goes and does the missing part. Only the second one closes a
 * ground-exhaustion failure, because closing that one means opening a file.
 */
export function repairAssignment(request: RepairRequest): string {
  const lines: string[] = [];

  lines.push(
    'Your draft is not finished. The free checks your brief declared ran against ' +
      'it, and these did not pass. None of them is a judgement about whether your ' +
      'reasoning is any good — each one says a piece of work the brief asked for is ' +
      'not present in what you submitted.',
    '',
  );

  for (const failure of request.failures) {
    lines.push(`- ${failure.challenge}: ${failure.detail}`);
    const cheap = cheapFixFor(failure.challenge);
    if (cheap !== null) lines.push(`  Do not close this by: ${cheap}`);
  }

  lines.push(
    '',
    'Finish the work, then send back the whole deliverable — every section, ' +
      'including the parts that already passed. Not a patch and not the missing ' +
      'piece on its own: what you return is what the reader receives, and a ' +
      'document assembled to satisfy a checker is written to the wrong audience.',
  );

  if (request.groundRoots !== undefined && request.groundRoots.length > 0) {
    lines.push(
      '',
      'You still hold the same license you held the first time. Any document ' +
        'under these roots is yours to open, by its full path, whatever your ' +
        'first draft happened to read:',
      ...request.groundRoots.map((root) => `- ${root}`),
      '',
      'A file you named and did not open is the most common reason a draft comes ' +
        'back. Open it. If it will not open, say what error you got — that is a ' +
        'fact about your access and it belongs in the deliverable.',
    );
  }

  lines.push(
    '',
    'This is the only time it comes back. What still does not pass after this ' +
      'goes to the reader as it stands, with the failing checks named beside it, ' +
      'so anything you leave short is something they will see you left short.',
  );

  return lines.join('\n');
}
