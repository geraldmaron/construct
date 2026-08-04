/**
 * A coordinator that will be killed while a role is in flight.
 *
 * Run as a child process by coordinator-crash.test.ts and SIGKILLed once it
 * reports ready. Nothing here cleans up on the way out, which is the point: the
 * guarantee under test is that a work log entry written before the kill is
 * still there afterwards, and that the task it names comes back as recoverable
 * rather than wedged. A fake "crash" that unwound its own state would prove
 * nothing about either.
 */

import { openStore } from '../../../../src/kernel/store/open.ts';
import { enqueueTask } from '../../../../src/kernel/store/tasks.ts';
import { workRun } from '../../../../src/kernel/run/coordinator.ts';
import type { HostResult } from '../../../../src/kernel/hosts/interface.ts';

const [dbPath] = process.argv.slice(2);
if (!dbPath) throw new Error('usage: crash-mid-run.ts <db path>');

const store = openStore(dbPath);
const at = '2026-08-03T00:00:00.000Z';

for (const role of ['privacy', 'security']) {
  enqueueTask(store, {
    id: `t-${role}`,
    run: 'run-1',
    role,
    brief: { id: `t-${role}`, outcome: 'ship it', role, inputs: [], capabilities: [], postconditions: [] },
    at,
  });
}

const host = {
  name: 'never-answers',
  kind: 'general',
  capabilities: [],
  init: async (): Promise<void> => {},
  health: async () => ({ live: true }),
  cancel: async () => ({ cancelled: false }),
  invoke: async (): Promise<HostResult> => {
    // The dispatch log entry and the lease are both written by now.
    process.stdout.write('ready\n');
    return new Promise<HostResult>(() => {
      /* never settles — the parent kills us here */
    });
  },
};

await workRun(store, host, {
  owner: 'doomed',
  clock: () => at,
  spendCeiling: 100,
  concurrency: 1,
  leaseMs: 60 * 1000,
});
