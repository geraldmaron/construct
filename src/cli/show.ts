/**
 * cli/show.ts — reading a run back: its deliverables, its event stream, and
 * the decisions waiting on you.
 *
 * Three surfaces, one job. `show` prints the product, which no surface did
 * until it existed — `work` reported "done" with a cost and the text a user
 * paid for sat in the store readable only by hand. `log` prints the
 * append-only stream and, under it, where the run currently stands, because a
 * run in flight and a run that died end at the same log line. `inbox` prints
 * what is genuinely the user's to decide.
 */

import type { Store } from '../kernel/store/open.ts';
import { readWorkLog } from '../kernel/store/worklog.ts';
import { listTasks } from '../kernel/store/tasks.ts';
import { openDecisions } from '../kernel/store/decisions.ts';
import { pendingProposalCount } from '../kernel/store/sources.ts';
import { externalReadsFor } from '../kernel/store/externalreads.ts';
import { CAPABILITY_DENIED_ACTION } from '../kernel/run/rolewrite.ts';
import { latestDraft, promotionOf } from '../kernel/run/promotion.ts';
import { licensedReviewFor, limitsFor } from '../kernel/run/accountability.ts';
import { deliverableBody, renderAttribution, renderDocument } from '../kernel/run/publish.ts';
import { citedAuthorityFor } from '../kernel/run/sourcereads.ts';
import { playbookFor } from '../kernel/plan/playbooks.ts';
import { unheadedSlots } from '../kernel/plan/ladder.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { withStore } from './runtime.ts';
import { writeTotalFailureRecourse } from './present.ts';
import { runFlag } from './flags.ts';
import { jsonFlag, writeJson } from './json.ts';

/**
 * How an entry's inference was reached, when that is not the free default
 *. Keyword inferences stay unannotated so the log does not grow
 * a column that says "normal" on almost every line; an entry that cost a model
 * call says so, because reading the log is how a user audits what was spent and
 * what an inference actually rests on.
 */
function howInferred(detail: unknown): string {
  const inferredBy = (detail as { inferredBy?: unknown } | null)?.inferredBy;
  if (inferredBy === 'namer') return '  (inferred by: namer — a model read the outcome)';
  if (inferredBy === 'cache') return '  (inferred by: cache — an earlier consultation for this outcome)';
  if (inferredBy === 'user') return '  (named by: the user — not inferred)';
  return '';
}

/**
 * The recorded reason on entries that carry one. The store holds the whole
 * detail; a failure or degradation line that reads as a bare action name
 * defeats the append-only record — the reason survived only in the terminal
 * that produced it. This stays a clause on the known reason-bearing kinds,
 * not a general detail dump: the log keeps one line per entry.
 */
export function reasonClause(action: string, detail: unknown): string {
  const d = detail as Record<string, unknown> | null;
  const s = (key: string): string | undefined =>
    typeof d?.[key] === 'string' && (d[key] as string).trim() !== '' ? (d[key] as string) : undefined;
  switch (action) {
    case 'namer-failed': {
      const failure = s('failure') ?? 'reason not recorded';
      const fellBackTo = s('fellBackTo');
      return `  — ${failure}${fellBackTo ? `; fell back to ${fellBackTo}` : ''}`;
    }
    case 'concern-unmet': {
      // The proposal's own words, not a paraphrase: the value of this line is
      // that a reader can see what the catalog was asked for and judge whether
      // it should carry it.
      const proposed = s('proposed') ?? 'unnamed';
      const reason = s('reason') ?? 'reason not recorded';
      const why = s('why');
      return `  — "${proposed}" (${reason})${why ? `: ${why}` : ''}`;
    }
    case 'namer-retried':
      return `  — first reply failed (${s('firstFailure') ?? 'unparseable'}); a corrective retry answered`;
    case 'model-untuned-best-effort':
      return `  — ${s('model') ?? 'model unknown'}: no tuning evidence for this family; output is best-effort`;
    case 'model-floor-degraded':
      return `  — ${s('why') ?? 'reason not recorded'}`;
    case 'extraction-refused':
      return `  — ${s('reason') ?? 'reason not recorded'}`;
    case 'role-failed':
      return `  — ${s('error') ?? s('status') ?? 'reason not recorded'}`;
    case 'dispatch-halted':
      return `  — ${s('reason') ?? 'reason not recorded'}`;
    case 'voice-overridden':
      return `  — ${s('instruction') ?? 'instruction not recorded'}`;
    default:
      return '';
  }
}

/**
 * The deliverable is the product, and until this command existed no surface
 * showed it: `work` reported "done" with the cost, `log` reported action
 * names, and the text a user paid for sat in the store readable only by hand.
 * A spine that ends at "done" without showing the work is missing its last
 * step.
 *
 * What it shows is the reader's view, the same one compose hands back. The
 * stored deliverable keeps every marker the gates read and this command
 * printed them verbatim, so the one surface a person reads a deliverable on
 * was the one place the record form reached them — "[unverified]" three times
 * down a page reads as evasion, and the sentence underneath is not evasive.
 * `--record` asks for the stored form, for anything checking the text rather
 * than reading it.
 */
export function show(argv: string[]): number {
  const run = runFlag(argv);
  const asRecord = argv.includes('--record');
  const asJson = jsonFlag(argv);
  if (!run) {
    process.stderr.write('usage: construct show --run <id> [--record] [--json]\n');
    return 2;
  }

  return withStore((store) => {
    const tasks = listTasks(store, run);
    if (asJson) {
      // The stored record, not the reader's rendering: each task as it is
      // held, its draft's raw deliverable, and the external reads beside it —
      // the same facts `show`'s prose is built from, not that prose itself.
      writeJson({
        run,
        tasks: tasks.map((task) => {
          const draft = latestDraft(store, task.id);
          const promotion = promotionOf(store, task.id);
          const deliverable = draft?.deliverable ?? task.result;
          return {
            id: task.id,
            role: task.role,
            state: task.state,
            deliverableKind: playbookFor(task.role).template.deliverable,
            promotion: promotion?.state ?? null,
            licensedReview: licensedReviewFor(task.role),
            limits: limitsFor(store, task.run, task.id).map((l) => l.label),
            hasDraft: draft !== null,
            deliverable: deliverable === null || deliverable === undefined ? null : deliverableBody(deliverable),
          };
        }),
        externalReads: externalReadsFor(store, run),
      });
      return 0;
    }
    if (tasks.length === 0) {
      process.stdout.write(`no tasks for ${run}. Record an outcome first: construct outcome "<what you want>"\n`);
      return 0;
    }
    // What the workspace said the ground is, so a citation carries its
    // standing: a claim resting on an aspirational document reads as one.
    const authority = citedAuthorityFor(store, run);
    for (const task of tasks) {
      const draft = latestDraft(store, task.id);
      const promotion = promotionOf(store, task.id);
      const template = playbookFor(task.role).template;
      process.stdout.write(
        `\nConstruct · ${template.deliverable}, framed through ${renderAttribution(task.role)} — ${task.state}`,
      );
      if (promotion) process.stdout.write(` · ${promotion.state}`);
      const review = licensedReviewFor(task.role);
      if (review) {
        process.stdout.write(
          `\n  issue-spotting only: needs review by a licensed ${review} before you rely on it`,
        );
      }
      // What produced this, stated with it. A role with no lens has no
      // labeling rule of its own, so without this the untuned fact reached
      // nobody reading the deliverable — which is everybody who reads it.
      for (const limit of limitsFor(store, task.run, task.id)) {
        process.stdout.write(`\n  ${escapeForTerminal(limit.label)}`);
      }
      process.stdout.write('\n');
      // A draft submitted through the write surface is the deliverable of
      // record; a role whose host has no write-through leaves its reply in the
      // task result, and showing nothing there would hide real work.
      const deliverable = draft?.deliverable ?? task.result;
      if (deliverable === null || deliverable === undefined) {
        process.stdout.write('  (no deliverable was produced for this task)\n');
        continue;
      }
      if (!draft) process.stdout.write('  (from the role\'s reply; no draft was submitted)\n');
      const text = deliverableBody(deliverable);
      const body = escapeForTerminal(asRecord ? text : renderDocument(text, authority))
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      process.stdout.write(`${body}\n`);
      const missing = unheadedSlots(template, text);
      if (missing.length > 0) {
        process.stdout.write(
          `  (${template.deliverable} asks for ${missing.map((g) => g.slot.name).join(', ')} ` +
            'and no section was headed there — a fact about this deliverable, not a reason it was withheld)\n',
        );
      }
    }

    // Two kinds of ground, named apart. What the survey walked is a document
    // this run can point at; what a role read through its host's own tools is
    // testimony Construct never saw and cannot check. Folding them into one
    // "grounded in" line would let the second borrow the first's standing.
    const external = externalReadsFor(store, run);
    if (external.length > 0) {
      process.stdout.write(
        `\nread outside the declared ground (${String(external.length)}), reported by the role ` +
          'and not verified by Construct:\n',
      );
      for (const read of external) {
        process.stdout.write(
          `  ${read.role}: ${escapeForTerminal(read.locator)}\n    took: ${escapeForTerminal(read.took)}\n`,
        );
      }
    }
    return 0;
  });
}

export function log(argv: string[]): number {
  const run = runFlag(argv);

  return withStore((store) => {
    const entries = readWorkLog(store, run);
    if (jsonFlag(argv)) {
      // The append-only stream itself plus the task rows the footer below is
      // derived from — the record the footer's prose reads, not the prose.
      writeJson({ run: run ?? null, entries, tasks: listTasks(store, run) });
      return 0;
    }
    if (entries.length === 0) {
      process.stdout.write(run ? `no work log entries for ${run}\n` : 'work log is empty\n');
      return 0;
    }
    for (const entry of entries) {
      process.stdout.write(
        `${String(entry.seq).padStart(4)}  ${entry.at}  ${entry.role}  ${entry.action}` +
          `${howInferred(entry.detail)}${escapeForTerminal(reasonClause(entry.action, entry.detail))}\n`,
      );
    }
    process.stdout.write(`\n${entries.length} entries (append-only).\n`);
    writeRunState(store, run);
    return 0;
  });
}

/**
 * Where a run currently stands, under the event stream.
 *
 * The defect this closes: a run in flight and a run that died end at the SAME
 * log line. A failed task writes no event past `capability-issued`, and neither
 * does a task that is still executing — so the two are indistinguishable from
 * the stream alone. Found on a live, healthy run that was reasonably read as
 * hung, where telling them apart meant opening construct.db by hand.
 *
 * Why this lives on `log` rather than a new `construct status` verb. The user
 * whose confusion produced the bead reached for `construct log`, so answering
 * anywhere else costs a discovery step at exactly the moment someone is unsure
 * whether their run is broken. It also honours the project's preference for
 * extending an existing surface over adding one.
 *
 * The stream itself is untouched and stays append-only: this is a footer that
 * reads current task state, clearly separated from the events above it. Nothing
 * here mutates, and nothing polls — it is one read of what the store already
 * holds, which is the whole reason the CLI could have said it all along.
 */
/**
 * Denials of one grant by one role above which the count is worth a line.
 *
 * Three rather than one, because a single denial is a role discovering its
 * grants and a second is it confirming; a third is a loop. Set here rather
 * than tuned per surface, so the log and any later surface agree on what a
 * flood is.
 */
const DENIAL_FLOOD = 3;

function writeRunState(store: Store, run?: string): void {
  const tasks = listTasks(store, run);
  if (tasks.length === 0) return;

  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.state, (counts.get(task.state) ?? 0) + 1);

  const parts = [...counts.entries()].map(([state, n]) => `${String(n)} ${state}`);
  process.stdout.write(`${tasks.length} task(s): ${parts.join(', ')}.\n`);

  // A denial is the write surface working: a role reached for a grant it does
  // not hold and was told no. A *flood* of them is different information — it
  // is the run's own evidence that a role is fighting its grants, usually
  // retrying one call in a loop, and it was visible only to somebody who opened
  // the raw log already knowing to count. Counted here rather than reported per
  // event, because the individual denial is noise and the rate is the finding.
  const denials = new Map<string, number>();
  for (const entry of readWorkLog(store, run)) {
    if (entry.action !== CAPABILITY_DENIED_ACTION) continue;
    const detail = entry.detail as { grant?: unknown } | null;
    const grant = typeof detail?.grant === 'string' ? detail.grant : 'a grant it does not hold';
    denials.set(`${entry.role}:${grant}`, (denials.get(`${entry.role}:${grant}`) ?? 0) + 1);
  }
  const flooding = [...denials.entries()].filter(([, n]) => n >= DENIAL_FLOOD);
  if (flooding.length > 0) {
    for (const [who, n] of flooding) {
      const [role, grant] = who.split(':');
      process.stdout.write(
        `${role} was denied ${escapeForTerminal(grant)} ${String(n)} times — the surface held, and a role ` +
          'retrying one call that many times is reading the refusal as a transient error ' +
          'rather than as an answer.\n',
      );
    }
  }

  // A lease with time left is the one fact that separates "still working" from
  // "stopped", and it is the fact nobody could see. Report the deadline rather
  // than a remaining-time countdown, so the line does not imply it is watching.
  const leased = tasks.filter((t) => t.state === 'leased' && t.leaseUntil);
  const asOf = new Date().toISOString();
  const running = leased.filter((t) => (t.leaseUntil as string) > asOf);
  const expired = leased.filter((t) => (t.leaseUntil as string) <= asOf);
  if (running.length > 0) {
    const latest = running
      .map((t) => t.leaseUntil as string)
      .reduce((a, b) => (a > b ? a : b));
    process.stdout.write(
      `Still running — ${String(running.length)} task(s) hold a lease until ${latest}. ` +
        'Re-read this log rather than re-running work; work will not take a live lease.\n',
    );
  }
  // A lease is only evidence of work in flight while it has time left. A
  // coordinator that died after claiming leaves the row exactly as a healthy
  // one looks, and reporting the two the same way asked the reader to compare
  // a timestamp against the clock and do the arithmetic before they could tell
  // whether anything was happening.
  if (expired.length > 0) {
    const stalest = expired
      .map((t) => t.leaseUntil as string)
      .reduce((a, b) => (a < b ? a : b));
    process.stdout.write(
      `Stopped — ${String(expired.length)} task(s) hold a lease that expired at ${stalest}, ` +
        'so no coordinator is working them. Run `construct work` to take them back over; ' +
        'the fencing token makes a re-dispatch safe.\n',
    );
  }
  if (running.length > 0 || expired.length > 0) return;

  const failed = tasks.filter((t) => t.state === 'failed');
  if (failed.length > 0 && failed.length === tasks.length) {
    writeTotalFailureRecourse(failed.length);
  } else if (failed.length > 0) {
    process.stdout.write(
      `${String(failed.length)} task(s) failed and produced no deliverable; their errors are above.\n`,
    );
  }
}

export function inbox(argv: string[] = []): number {
  return withStore((store) => {
    const open = openDecisions(store);
    // Waiting outward changes are calls on the user exactly as decisions are,
    // and an inbox that says "nothing needs you" while proposals wait is
    // wrong. A pointer, not a second rendering: the queue has one listing.
    const waiting = pendingProposalCount(store);
    if (jsonFlag(argv)) {
      writeJson({ openDecisions: open, pendingProposals: waiting });
      return 0;
    }
    const waitingLine =
      waiting > 0
        ? `${String(waiting)} outward change${waiting === 1 ? '' : 's'} waiting — see: construct decide --pending\n`
        : '';
    if (open.length === 0) {
      process.stdout.write(
        waiting > 0
          ? `decision inbox: no open decisions.\n${waitingLine}`
          : 'decision inbox: empty. Nothing needs you right now.\n',
      );
      return 0;
    }
    process.stdout.write(`decision inbox (${open.length}):\n\n`);
    for (const decision of open) {
      process.stdout.write(`  ${decision.id}  ${escapeForTerminal(decision.question)}\n`);
      for (const position of decision.positions) {
        const cited = position.citation ? ` [${escapeForTerminal(position.citation)}]` : ' [unverified]';
        process.stdout.write(`      ${position.role}: ${escapeForTerminal(position.stance)}${cited}\n`);
      }
      process.stdout.write('\n');
    }
    process.stdout.write(`Resolve with: construct decide <id> "<your call>"\n${waitingLine}`);
    return 0;
  });
}
