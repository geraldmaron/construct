/**
 * tests/harness/plant-deliverables.ts — settle pending home-store tasks after
 * `outcome` without invoking deleted ambient `construct work` dispatch.
 *
 * Compose / propose / show tests need done deliverables in the store. The
 * product path that used to produce them (`work --all` against a stand-in
 * host) is gone; planting claim/complete here keeps those surfaces under
 * test without restoring the legacy verb.
 */

import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import type { Store } from '../../src/kernel/store/open.ts';
import { claimTask, completeTask, listTasks } from '../../src/kernel/store/tasks.ts';
import { appendWorkLog } from '../../src/kernel/store/worklog.ts';
import { VOICE_OVERRIDE_ACTION } from '../../src/kernel/run/voicerecord.ts';
import { groundRun } from '../../src/kernel/run/groundpass.ts';
import { surveyor } from '../../src/cli/survey.ts';

const AT = '2026-08-31T12:00:00.000Z';
const LEASE_UNTIL = '2099-01-01T00:00:00.000Z';
const OWNER = 'test-plant';

/** Default body matches the stand-in hosts compose tests used to dispatch. */
export function composeFinding(role: string): { text: string } {
  return { text: `## finding\n${role} concluded its own part and nothing else.` };
}

export interface PlantDeliverablesOptions {
  /** Restrict claims to one run. Omit to drain every pending task. */
  readonly run?: string;
  /** Deliverable body per role. Defaults to composeFinding. */
  readonly bodyFor?: (role: string) => unknown;
  /**
   * Record a voice-overridden work-log entry on each planted task, the way
   * the coordinator did when `work --voice` shaped a dispatch.
   */
  readonly voice?: { readonly instruction: string; readonly source: string };
  /**
   * Survey declared sources and record reads before settling, so citation
   * surfaces (show / publish) can resolve authority tiers.
   */
  readonly ground?: boolean;
  /**
   * Extra work-log rows written after each settle (e.g. a minimal
   * role-dispatched detail a test asserts on).
   */
  readonly afterSettle?: (store: Store, task: { id: string; run: string; role: string }) => void;
  readonly at?: string;
}

/**
 * Claim and complete every pending task in the current home store.
 * Returns how many tasks were settled.
 */
export function plantCompletedDeliverables(opts: PlantDeliverablesOptions = {}): number {
  const at = opts.at ?? AT;
  const bodyFor = opts.bodyFor ?? composeFinding;
  const store = openStore(storePath(resolvePaths()));
  try {
    if (opts.ground) {
      const runs = new Set(
        listTasks(store, opts.run)
          .filter((task) => task.state === 'pending' || task.state === 'leased')
          .map((task) => task.run),
      );
      for (const run of runs) groundRun(store, run, at, surveyor(store));
    }

    let planted = 0;
    for (;;) {
      const leased = claimTask(store, {
        owner: OWNER,
        leaseUntil: LEASE_UNTIL,
        now: at,
        ...(opts.run !== undefined ? { run: opts.run } : {}),
      });
      if (!leased) break;
      const raw = bodyFor(leased.role);
      completeTask(store, {
        id: leased.id,
        owner: OWNER,
        token: leased.token,
        result: typeof raw === 'string' ? { text: raw } : raw,
        spend: 0,
        spendReported: false,
        at,
      });
      if (opts.voice) {
        appendWorkLog(store, {
          run: leased.run,
          task: leased.id,
          role: leased.role,
          action: VOICE_OVERRIDE_ACTION,
          detail: { instruction: opts.voice.instruction, source: opts.voice.source },
          at,
        });
      }
      opts.afterSettle?.(store, { id: leased.id, run: leased.run, role: leased.role });
      planted += 1;
    }
    return planted;
  } finally {
    store.close();
  }
}
