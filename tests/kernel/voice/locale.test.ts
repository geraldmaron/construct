/**
 * tests/kernel/voice/locale.test.ts — prose is localized, the record never is.
 *
 * Locale rides the same seam commitment 17 built for voice: bound into the
 * identity instruction before the work happens, defaulting to American
 * English when nothing more specific was resolved. The tests here hold three
 * things: the identity instruction states the locale (default and
 * overridden), the settings ladder is what resolves it (default when
 * unset, an override when one is set), and — the part that actually matters —
 * the stored record and its timestamps are the same bytes no matter which
 * locale a run's deliverables were rendered in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { DEFAULT_LOCALE, constructIdentity } from '../../../src/kernel/voice/voice.ts';
import { assignmentFor, workRun } from '../../../src/kernel/run/coordinator.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { enqueueTask, getTask } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { resolvedLocale } from '../../../src/cli/locale.ts';
import type { HostAdapter, HostContext, HostResult } from '../../../src/kernel/hosts/interface.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const AT = '2026-08-03T00:00:00.000Z';
const frozen = (at: string) => (): string => at;

function brief(role: string): Brief {
  return {
    id: `t-${role}`,
    outcome: 'launch a paid beta to EU users next month',
    role,
    inputs: [],
    capabilities: [],
    postconditions: [],
  };
}

/** A host that echoes a fixed deliverable regardless of what it was asked, and
 * records the assignment text it actually received. */
function recordingHost(): HostAdapter & { readonly assignments: string[] } {
  const assignments: string[] = [];
  const host = {
    name: 'fake',
    kind: 'general',
    capabilities: ['concurrent'] as const,
    assignments,
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    async invoke(request: unknown, context?: HostContext): Promise<HostResult> {
      const req = request as { role: string; task: string };
      assignments.push(req.task);
      const id = context?.invocationId ?? req.role;
      return {
        id,
        status: 'ok',
        output: { text: `${req.role} reporting`, usage: { cost: 0.1, steps: 1 } },
        error: null,
      };
    },
  };
  return host as unknown as HostAdapter & { readonly assignments: string[] };
}

function withFreshStore<T>(fn: (store: Store) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

async function withFreshStoreAsync<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return await fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

test('the identity instruction states the locale — the house default, unconditionally', () => {
  const identity = constructIdentity({ framedBy: 'privacy', concern: 'personal data and consent' });
  assert.equal(DEFAULT_LOCALE, 'en-US');
  assert.match(identity, /Write for a en-US reader/);
  assert.match(identity, /never reaches the record/);
});

test('an overridden locale replaces the default in the identity instruction', () => {
  const identity = constructIdentity({ locale: 'en-GB' });
  assert.match(identity, /Write for a en-GB reader/);
  assert.ok(!identity.includes('en-US'), 'the default must not linger beside an override');
});

test('the dispatch assignment carries the locale the same way it carries the voice', () => {
  const b = brief('privacy');
  const houseAssignment = assignmentFor(b);
  assert.match(houseAssignment, /Write for a en-US reader/);

  const overridden = assignmentFor(b, undefined, { locale: 'en-GB' });
  assert.match(overridden, /Write for a en-GB reader/);
  assert.ok(!overridden.includes('en-US'));
});

test('locale resolves through the settings ladder: the built-in default when nothing overrides it', () => {
  withFreshStore((store) => {
    const fixture = sterile();
    try {
      const locale = resolvedLocale(store, {
        cwd: fixture.root,
        env: { PATH: process.env.PATH ?? '' },
      });
      assert.equal(locale, 'en-US');
    } finally {
      fixture.cleanup();
    }
  });
});

test('locale resolves through the settings ladder: a CONSTRUCT_LOCALE override wins over the default', () => {
  withFreshStore((store) => {
    const fixture = sterile();
    try {
      const locale = resolvedLocale(store, {
        cwd: fixture.root,
        env: { PATH: process.env.PATH ?? '', CONSTRUCT_LOCALE: 'en-GB' },
      });
      assert.equal(locale, 'en-GB');
    } finally {
      fixture.cleanup();
    }
  });
});

test('the invariant: the stored record and its timestamps are byte-identical whatever locale a run rendered in', async () => {
  const seed = (store: Store): void => {
    enqueueTask(store, { id: 't-privacy', run: 'run-1', role: 'privacy', brief: brief('privacy'), at: AT });
  };

  const [usResult, gbResult] = await Promise.all([
    withFreshStoreAsync(async (store) => {
      seed(store);
      const host = recordingHost();
      const report = await workRun(store, host, {
        owner: 'w1',
        clock: frozen(AT),
        spendCeiling: 100,
        locale: 'en-US',
      });
      return {
        report,
        task: getTask(store, 't-privacy'),
        log: readWorkLog(store, 'run-1'),
        assignment: host.assignments[0],
      };
    }),
    withFreshStoreAsync(async (store) => {
      seed(store);
      const host = recordingHost();
      const report = await workRun(store, host, {
        owner: 'w1',
        clock: frozen(AT),
        spendCeiling: 100,
        locale: 'en-GB',
      });
      return {
        report,
        task: getTask(store, 't-privacy'),
        log: readWorkLog(store, 'run-1'),
        assignment: host.assignments[0],
      };
    }),
  ]);

  // What the host actually received differs — that is the whole point of
  // binding locale at dispatch.
  assert.match(usResult.assignment, /Write for a en-US reader/);
  assert.match(gbResult.assignment, /Write for a en-GB reader/);
  assert.notEqual(usResult.assignment, gbResult.assignment);

  // What landed in the store is the same regardless. The task record —
  // including its stored timestamps — never varies with locale.
  assert.deepEqual(usResult.task, gbResult.task, 'the stored task record must not vary with locale');

  // The work log — every entry, every ISO timestamp on it — is identical.
  // Strip nothing: if locale ever leaks into a log entry, this catches it.
  assert.deepEqual(usResult.log, gbResult.log, 'the work log must not vary with locale');

  // And the run report itself carries no trace of which locale was in force.
  assert.deepEqual(usResult.report, gbResult.report);
});
