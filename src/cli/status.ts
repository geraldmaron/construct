/**
 * cli/status.ts — one screen answering "where am I right now": the latest
 * run and its task counts, what is waiting in the decision inbox, pending
 * write proposals, and which host this process is running inside.
 *
 * Modeled on `gh pr status`: a compact dashboard read at a glance, not a
 * report to page through. Every figure here is read through the same store
 * query an existing verb already runs — `show`'s task listing, `inbox`'s
 * decision and proposal counts, `doctor`'s ambient-host check — gathered onto
 * one screen rather than computed fresh. Read-only, like `show`, `log`, and
 * `plan`: nothing here mutates.
 */

import { countTasksByState, listTasks } from '../kernel/store/tasks.ts';
import { latestOutcomeReceivedRun } from '../kernel/store/worklog.ts';
import { openDecisions } from '../kernel/store/decisions.ts';
import { pendingProposalCount } from '../kernel/store/sources.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import type { AmbientDetection } from '../hosts/ambient.ts';
import { withStore } from './runtime.ts';
import { jsonFlag, writeJson } from './json.ts';

function ambientLine(ambient: AmbientDetection | null): string {
  return ambient === null
    ? 'ambient host: none detected'
    : `ambient host: ${ambient.host} (detected via ${ambient.marker})`;
}

/**
 * The workspace's current state, in one view.
 *
 * "Latest run" is the most recently recorded outcome, not the last enqueued
 * task. A later record that queued no work is still the latest run — showing
 * an older run's tasks in its place is pointing at someone else's work. A
 * store with no outcomes at all answers gracefully rather than erroring.
 */
export function status(argv: string[] = []): number {
  const asJson = jsonFlag(argv);

  return withStore((store) => {
    const latestRun = latestOutcomeReceivedRun(store) ?? null;
    const runTasks = latestRun !== null ? listTasks(store, latestRun) : [];
    const counts = latestRun !== null ? countTasksByState(store, latestRun) : {};
    const openInbox = openDecisions(store);
    const waitingProposals = pendingProposalCount(store);
    const ambient = detectAmbientHost();

    if (asJson) {
      // The same facts the prose below narrates, not a second computation of
      // them: a script reading `--json` sees exactly what a person reading
      // the dashboard sees.
      writeJson({
        latestRun,
        taskCounts: latestRun !== null ? { total: runTasks.length, ...counts } : null,
        openDecisions: openInbox.length,
        pendingProposals: waitingProposals,
        ambient: ambient !== null ? { host: ambient.host, marker: ambient.marker } : null,
      });
      return 0;
    }

    if (latestRun === null) {
      process.stdout.write(
        ambient !== null
          ? `no named work yet — talk in ${ambient.host}. This session names via MCP record_outcome with namings.\n`
          : 'no runs yet — record one with construct outcome "<what you want>"\n',
      );
    } else {
      const pending = (counts.pending ?? 0) + (counts.leased ?? 0);
      const done = counts.done ?? 0;
      const failed = counts.failed ?? 0;
      process.stdout.write(`latest run: ${latestRun}\n`);
      if (runTasks.length === 0) {
        process.stdout.write(
          '  0 task(s): this run has no named work\n' +
            '  This session names via MCP record_outcome with namings\n',
        );
      } else {
        process.stdout.write(
          `  ${String(runTasks.length)} task(s): ${String(done)} done, ${String(pending)} pending, ` +
            `${String(failed)} failed\n`,
        );
        process.stdout.write(`  construct show --run=${latestRun}   construct log --run=${latestRun}\n`);
      }
    }

    process.stdout.write(
      openInbox.length > 0
        ? `open decisions: ${String(openInbox.length)} — construct inbox\n`
        : 'open decisions: none\n',
    );
    process.stdout.write(
      waitingProposals > 0
        ? `pending proposals: ${String(waitingProposals)} — construct decide --pending\n`
        : 'pending proposals: none\n',
    );
    process.stdout.write(`${ambientLine(ambient)}\n`);
    return 0;
  });
}
