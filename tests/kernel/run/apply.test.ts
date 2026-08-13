/**
 * tests/kernel/run/apply.test.ts — carrying out an approved outward change.
 *
 * The properties held here: only an approved proposal is handed to a host, a
 * rejection is never overridden by a surface that can also apply, and the
 * applied decision is written only from what the host reported succeeding —
 * a host that failed, that could not be reached, or that answered
 * illegibly leaves the proposal approved and unapplied, because recording an
 * apply the world never received is the failure the module exists to prevent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { addSource, decideProposal, decisionOf, proposeWrite } from '../../../src/kernel/store/sources.ts';
import { applyProposal } from '../../../src/kernel/run/apply.ts';
import type { ApplyReport } from '../../../src/kernel/run/apply.ts';
import { CLAUDE_CAPABILITIES } from '../../../src/hosts/claude/adapter.ts';
import { CODEX_CAPABILITIES } from '../../../src/hosts/codex/adapter.ts';
import { CURSOR_CAPABILITIES } from '../../../src/hosts/cursor/adapter.ts';
import { OPENCODE_CAPABILITIES } from '../../../src/hosts/opencode/adapter.ts';

const AT = '2026-08-13T00:00:00.000Z';
const LATER = '2026-08-14T00:00:00.000Z';

function withStore<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  return fn(store).finally(() => {
    store.close();
    fixture.cleanup();
  });
}

function seed(store: Store): void {
  addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: AT });
  proposeWrite(store, {
    id: 'p-1',
    workspace: 'acme',
    run: 'run-1',
    source: 'src-1',
    change: 'move PROJ-14 target date to Q4',
    justification: 'note:n-1#L3',
    risk: 'low',
    proposedAt: AT,
  });
}

function applier(report: ApplyReport | Error) {
  return async (): Promise<ApplyReport> => {
    if (report instanceof Error) throw report;
    return report;
  };
}

test('an approved proposal a host carried out is recorded applied, from what the host said', async () => {
  await withStore(async (store) => {
    seed(store);
    decideProposal(store, 'p-1', 'approved', 'yes, move it', AT);
    const result = await applyProposal(
      store,
      applier({ applied: true, detail: 'set PROJ-14 due date to 2026-12-31' }),
      'p-1',
      LATER,
    );
    assert.equal(result.outcome, 'applied');
    const decision = decisionOf(store, 'p-1');
    assert.equal(decision?.verdict, 'applied');
    assert.match(decision?.reason ?? '', /PROJ-14 due date/);
  });
});

test('a host that cannot reach the system leaves it approved and unapplied, with the reason', async () => {
  await withStore(async (store) => {
    seed(store);
    decideProposal(store, 'p-1', 'approved', 'yes, move it', AT);
    const result = await applyProposal(
      store,
      applier({ applied: false, detail: 'I have no Jira connector' }),
      'p-1',
      LATER,
    );
    assert.equal(result.outcome, 'unappliable');
    assert.match(result.outcome === 'unappliable' ? result.reason : '', /no Jira connector/);
    assert.match(result.outcome === 'unappliable' ? result.reason : '', /still yours to make/);
    assert.equal(decisionOf(store, 'p-1')?.verdict, 'approved', 'the honest state is unchanged');
  });
});

test('a host that could not be asked at all records nothing: an unknown is not a failure to apply', async () => {
  await withStore(async (store) => {
    seed(store);
    decideProposal(store, 'p-1', 'approved', 'yes', AT);
    const result = await applyProposal(store, applier(new Error('host died')), 'p-1', LATER);
    assert.equal(result.outcome, 'unappliable');
    assert.match(result.outcome === 'unappliable' ? result.reason : '', /host died/);
    assert.equal(decisionOf(store, 'p-1')?.verdict, 'approved');
  });
});

test('a rejection is not overridden by a surface that can also apply', async () => {
  await withStore(async (store) => {
    seed(store);
    decideProposal(store, 'p-1', 'rejected', 'no, the date is right', AT);
    let asked = false;
    const result = await applyProposal(
      store,
      async () => {
        asked = true;
        return { applied: true, detail: 'done' };
      },
      'p-1',
      LATER,
    );
    assert.equal(result.outcome, 'refused');
    assert.match(result.outcome === 'refused' ? result.reason : '', /rejection is not overridden/);
    assert.equal(asked, false, 'a rejected change is never even attempted');
    assert.equal(decisionOf(store, 'p-1')?.verdict, 'rejected');
  });
});

test('an undecided proposal, an unknown one, and one already applied are all answers, not throws', async () => {
  await withStore(async (store) => {
    seed(store);
    const undecided = await applyProposal(store, applier({ applied: true, detail: 'd' }), 'p-1', LATER);
    assert.equal(undecided.outcome, 'refused');
    assert.match(undecided.outcome === 'refused' ? undecided.reason : '', /nobody has decided it yet/);

    const unknown = await applyProposal(store, applier({ applied: true, detail: 'd' }), 'p-none', LATER);
    assert.equal(unknown.outcome, 'refused');
    assert.match(unknown.outcome === 'refused' ? unknown.reason : '', /no proposal p-none/);

    decideProposal(store, 'p-1', 'approved', 'yes', AT);
    await applyProposal(store, applier({ applied: true, detail: 'd' }), 'p-1', LATER);
    const again = await applyProposal(store, applier({ applied: true, detail: 'd' }), 'p-1', LATER);
    assert.equal(again.outcome, 'refused');
    assert.match(again.outcome === 'refused' ? again.reason : '', /already applied/);
  });
});

test('a read-only host is declared unable rather than left to report failure per proposal', () => {
  // The postures are probed expectations, not guesses: cursor dispatches
  // --mode plan and codex -s read-only, so neither can act outside the
  // process however it is asked. Declaring that is what lets the apply
  // surface refuse before it spends a model call.
  assert.equal(CURSOR_CAPABILITIES.includes('outward-write'), false);
  assert.equal(CODEX_CAPABILITIES.includes('outward-write'), false);
  // And the two that pass no sandbox flag say so, which is the warning as
  // much as the permission.
  assert.equal(CLAUDE_CAPABILITIES.includes('outward-write'), true);
  assert.equal(OPENCODE_CAPABILITIES.includes('outward-write'), true);
});
