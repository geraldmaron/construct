/**
 * cli/reconcile.ts — whether a projected proposal still agrees with the
 * tracker it was mirrored into.
 *
 * The kernel holds no tracker connectors and this command imports no host
 * adapter, so freshness has to arrive from outside: `--live` names a file of
 * the issues the caller can currently see. Without one there is no live state
 * to compare against, and this declines to guess at one.
 */

import { readFileSync } from 'node:fs';
import { getDecision, raiseDecision } from '../kernel/store/decisions.ts';
import { listProjections } from '../kernel/store/projections.ts';
import { syncProjections } from '../kernel/store/reconcile.ts';
import { appendWorkLog } from '../kernel/store/worklog.ts';
import { reconcileAll } from '../kernel/tracker/reconcile.ts';
import { driftDecisions } from '../kernel/tracker/reconcileDecisions.ts';
import { now, withStore } from './runtime.ts';
import { parseFlags } from './flags.ts';

const RECONCILE_USAGE =
  'usage: construct reconcile [--tracker=<name>]\n' +
  '       construct reconcile --tracker=<name> --live=<file>\n' +
  '       construct reconcile --tracker=<name> --live=<file> --absorb\n';

/**
 * Whether a projected proposal (kernel/store/projections.ts) still agrees
 * with the tracker it was mirrored into.
 *
 * Comparison model, stated plainly because the substrate alone does not say
 * how a CLI should use it: the kernel holds no tracker connectors, this
 * command imports no host adapter, and it never fetches a live issue on its
 * own. Freshness has to arrive from outside. `--tracker=<name>
 * --live=<file>` names a JSON array of the issues the caller can currently
 * see in that one tracker — gathered however the caller likes, a `bd`
 * export, a Jira API call, a copy out of a UI — and this command's only job
 * is the honest, mechanical diff: kernel/tracker/reconcile.ts's existing
 * `reconcileAll` against the recorded projections for that tracker.
 * `in_sync`, `reconciling` (a tracker-owned field moved; absorbed, not a
 * conflict), `drifted` (a domain-owned field disagrees), and `missing` (the
 * read no longer contains the issue) are exactly `reconcileAll`'s own
 * vocabulary — nothing here invents a second one. `--tracker` is required
 * together with `--live` because a bare external id is unique only within
 * one tracker; reconciling several at once would let one tracker's issue
 * silently stand in for another's.
 *
 * Without `--live`, there is no live state to compare against, and this
 * command declines to guess at one — it reports the state each projection
 * already carries (`projected` for a mirror nobody has ever reconciled,
 * whatever a prior sync last recorded otherwise), plainly labeled as what
 * the store recorded rather than a live answer.
 *
 * Every projection `reconcileAll` finds drifted or missing is framed as a
 * decision (kernel/tracker/reconcileDecisions.ts) and raised into the inbox
 * unless the same disagreement is already waiting there — the decision id is
 * derived from the projection and which fields disagree, so a second run
 * over an unchanged disagreement raises nothing new. Nothing here resolves a
 * decision: which side is right on a domain-owned conflict stays a person's
 * call, made through `construct decide`, never this command.
 *
 * `--absorb` is the one thing that does write the stored mirror: it runs
 * kernel/store/reconcile.ts's `syncProjections` over the same live read, so a
 * tracker-owned change this run finds is adopted into the snapshot instead of
 * being reported as `reconciling` again next time. It is never implied by a
 * bare `--live` read — a run that only reports drift stays side-effect free,
 * so absorbing what it found is a second, explicit ask, recorded on the work
 * log. A domain-owned conflict is untouched either way: `syncProjections`
 * leaves the stored domain value exactly as it was and the projection stays
 * `drifted`, so `--absorb` changes when the mirror catches up, never who is
 * right about a disagreement.
 */
export function reconcile(argv: string[]): number {
  const { flags } = parseFlags(argv);
  if (flags.help !== undefined) {
    process.stdout.write(RECONCILE_USAGE);
    return 0;
  }
  const trackerFlag = flags.tracker?.trim();
  const tracker = trackerFlag && trackerFlag !== 'true' ? trackerFlag : undefined;
  const liveFlag = flags.live?.trim();
  const liveFile = liveFlag && liveFlag !== 'true' ? liveFlag : undefined;
  const absorb = flags.absorb !== undefined;

  if (liveFile !== undefined && tracker === undefined) {
    process.stderr.write(
      "reconcile: --live compares one tracker's projections against its live read; " +
        `name it with --tracker=<name>.\n${RECONCILE_USAGE}`,
    );
    return 2;
  }

  let liveIssues: Record<string, unknown>[] | null = null;
  if (liveFile !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(liveFile, 'utf8'));
    } catch (error) {
      process.stderr.write(
        `reconcile: cannot read a live tracker read from ${liveFile}: ${(error as Error).message}\n`,
      );
      return 1;
    }
    if (!Array.isArray(parsed)) {
      process.stderr.write(`reconcile: ${liveFile} must hold a JSON array of tracker issues.\n`);
      return 1;
    }
    liveIssues = parsed as Record<string, unknown>[];
  }

  return withStore((store) => {
    const projections = listProjections(store, tracker);
    if (projections.length === 0) {
      process.stdout.write(`no projected proposals recorded${tracker ? ` for tracker ${tracker}` : ''}.\n`);
      return 0;
    }

    if (liveIssues === null) {
      process.stdout.write(
        `${String(projections.length)} projected proposal(s)${tracker ? ` for ${tracker}` : ''}, ` +
          'reported from the store — no --live read was supplied, so none of this is verified this run:\n\n',
      );
      for (const projection of projections) {
        const recordedAt = projection.reconciledAt ?? projection.importedAt ?? 'an unrecorded time';
        process.stdout.write(`  ${projection.state.padEnd(11)} ${projection.id}  (recorded ${recordedAt})\n`);
      }
      process.stdout.write(
        '\nConstruct holds no tracker connectors, so it cannot read live state on its own.\n' +
          "Supply one: construct reconcile --tracker=<name> --live=<file of that tracker's current issues>\n",
      );
      return 0;
    }
    if (!tracker) {
      // Unreachable: validated before the store opened. Kept so nothing below
      // this line ever needs to assert the type away.
      process.stderr.write('reconcile: --live requires --tracker=<name>.\n');
      return 1;
    }

    const at = now();
    const run = `reconcile:${tracker}`;
    const report = absorb
      ? syncProjections(store, liveIssues, at, { tracker })
      : reconcileAll(projections, liveIssues, at);
    process.stdout.write(
      `${String(report.counts.total)} projected proposal(s) against the supplied live ${tracker} read:\n\n`,
    );
    for (const result of report.inSync) process.stdout.write(`  in_sync     ${result.external_id}\n`);
    for (const result of report.absorbed) {
      const fields = [...result.absorbed].map((a) => a.field).sort().join(', ');
      process.stdout.write(`  reconciling ${result.external_id}  (tracker-owned: ${fields})\n`);
    }
    for (const result of report.drifted) {
      const fields = [...result.conflicts].map((c) => c.field).sort().join(', ');
      process.stdout.write(`  drifted     ${result.external_id}  (${fields})\n`);
    }
    for (const entry of report.missing) {
      process.stdout.write(`  missing     ${entry.external_id}  (absent from the live read)\n`);
    }
    process.stdout.write(
      `\n${String(report.counts.inSync)} in_sync, ${String(report.counts.absorbed)} reconciling, ` +
        `${String(report.counts.drifted)} drifted, ${String(report.counts.missing)} missing.\n`,
    );

    if (absorb) {
      appendWorkLog(store, {
        run,
        role: 'construct',
        action: 'reconcile-absorbed',
        detail: {
          tracker,
          absorbed: report.absorbed.map((result) => result.external_id),
          drifted: report.counts.drifted,
          missing: report.counts.missing,
        },
        at,
      });
      process.stdout.write(
        `\n${String(report.counts.absorbed)} tracker-owned change(s) absorbed into the stored mirror ` +
          '(recorded on the work log). Domain-owned conflicts are unchanged and still need a decision.\n',
      );
    }

    const decisions = driftDecisions(report, projections);
    if (decisions.length === 0) {
      process.stdout.write('\nnothing drifted. Nothing was raised.\n');
      return 0;
    }

    let raised = 0;
    let standing = 0;
    process.stdout.write('\n');
    for (const decision of decisions) {
      if (getDecision(store, decision.id)) {
        standing += 1;
        process.stdout.write(`  standing  ${decision.id}\n`);
        continue;
      }
      raiseDecision(store, {
        id: decision.id,
        run,
        question: decision.question,
        positions: decision.positions,
        raisedAt: at,
      });
      raised += 1;
      process.stdout.write(`  raised    ${decision.id}\n`);
    }
    process.stdout.write(
      `\n${String(raised)} new decision(s) raised, ${String(standing)} already standing. ` +
        'Nothing here resolves a decision or writes to the tracker.\n' +
        (raised > 0 ? '  construct inbox\n' : ''),
    );
    return 0;
  });
}
