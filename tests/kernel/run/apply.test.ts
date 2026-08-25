/**
 * tests/kernel/run/apply.test.ts — carrying out an approved outward change.
 *
 * The properties held here: a change is handed to a host only with authority
 * behind it — a human approval on the proposal, or the workspace's standing
 * consent, which covers the low-risk class and never a high-risk change — a
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
import {
  addSource,
  decideProposal,
  decisionOf,
  proposeWrite,
  setEngagementMode,
  setSourceDeclaration,
  setWriteConsent,
} from '../../../src/kernel/store/sources.ts';
import { countProjections, getProjection } from '../../../src/kernel/store/projections.ts';
import { projectionFieldsByAuthority } from '../../../src/kernel/tracker/projection.ts';
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

test('standing consent hands a low-risk change over, and a high-risk one stops before the host', async () => {
  await withStore(async (store) => {
    seed(store);
    setWriteConsent(store, 'acme', true, AT);
    proposeWrite(store, {
      id: 'p-high',
      workspace: 'acme',
      run: 'run-1',
      source: 'src-1',
      change: 'close PROJ-9 as will-not-do',
      justification: 'note:n-1#L7',
      risk: 'high',
      proposedAt: AT,
    });

    // Neither has a decision of its own. The workspace's standing yes is
    // authority for the low-risk one, which is why it is asked at all.
    const low = await applyProposal(store, applier({ applied: true, detail: 'moved it' }), 'p-1', LATER);
    assert.equal(low.outcome, 'applied');
    assert.equal(decisionOf(store, 'p-1')?.basis, 'standing-consent');

    let asked = false;
    const high = await applyProposal(
      store,
      async () => {
        asked = true;
        return { applied: true, detail: 'closed it' };
      },
      'p-high',
      LATER,
    );
    assert.equal(high.outcome, 'refused');
    assert.match(
      high.outcome === 'refused' ? high.reason : '',
      /high-risk change is never carried out on standing consent/,
    );
    assert.equal(asked, false, 'the high-risk change never reached the host');
    assert.equal(decisionOf(store, 'p-high'), null, 'and left no decision behind');
  });
});

/**
 * The mirror of the test above, and the reason sensitivity is a declaration
 * rather than a note: standing consent is a workspace's yes to a class of
 * change, given before anyone knew which source it would land in. A source its
 * owner called sensitive is outside that yes, and the refusal happens here —
 * before the host is asked — because a gate that fires after the write leaves
 * someone else's system changed and this ledger ignorant of it.
 */
test('standing consent does not carry a low-risk change into a source declared sensitive', async () => {
  await withStore(async (store) => {
    seed(store);
    setWriteConsent(store, 'acme', true, AT);
    setSourceDeclaration(
      store,
      'src-1',
      { authority: 'working', relevance: 'the customer tracker', sensitive: true },
      AT,
    );

    let asked = false;
    const result = await applyProposal(
      store,
      async () => {
        asked = true;
        return { applied: true, detail: 'moved it' };
      },
      'p-1',
      LATER,
    );

    assert.equal(result.outcome, 'refused');
    assert.match(
      result.outcome === 'refused' ? result.reason : '',
      /declared sensitive, which standing consent does not cover/,
    );
    assert.equal(asked, false, 'the change never reached the host');
    assert.equal(decisionOf(store, 'p-1'), null, 'and left no decision behind');

    // The declaration is doing the work, not the risk class: the same
    // proposal applies once a person decides this one.
    decideProposal(store, 'p-1', 'approved', 'read it, and it is fine to send', LATER);
    const decided = await applyProposal(store, applier({ applied: true, detail: 'moved it' }), 'p-1', LATER);
    assert.equal(decided.outcome, 'applied');
    assert.equal(decisionOf(store, 'p-1')?.basis, 'human-approval');
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

// The seat-mode mirror: a change bound for the team's tracker is recorded as
// a projection before the host is asked to carry it, so a write landing in
// someone else's tracker can never outrun its record here. The properties:
// the row exists at the moment the applier runs, it carries only fields the
// domain may assert, and team mode / a non-tracker source / an undecided
// proposal record nothing.

test('in seat mode a tracker-bound change is mirrored before the host is asked', async () => {
  await withStore(async (store) => {
    seed(store);
    setEngagementMode(store, 'acme', 'seat', AT);
    decideProposal(store, 'p-1', 'approved', 'yes, move it', AT);

    let mirroredWhenAsked = 0;
    const result = await applyProposal(
      store,
      async () => {
        mirroredWhenAsked = countProjections(store);
        return { applied: true, detail: 'moved PROJ-14' };
      },
      'p-1',
      LATER,
    );

    assert.equal(mirroredWhenAsked, 1, 'the mirror row precedes the crossing');
    assert.equal(result.outcome, 'applied');
    assert.equal(result.outcome === 'applied' ? result.projected : '', 'jira:p-1');

    const mirror = getProjection(store, 'jira:p-1');
    assert.ok(mirror, 'the crossing is on the mirror');
    assert.equal(mirror.external_id, 'p-1');
    assert.equal(mirror.workspace, 'acme');
    assert.equal(mirror.work, 'run-1');
    // The row was written before the crossing and moves to in-sync only on the
    // host's report that it landed — the same evidence the applied verdict is
    // written from, so the two records cannot disagree.
    assert.equal(mirror.state, 'in_sync');
    assert.equal(mirror.reconciledAt, LATER);
    assert.equal(mirror.fields.title, 'move PROJ-14 target date to Q4');
    assert.match(String(mirror.fields.description), /move PROJ-14 target date to Q4/);
    assert.match(String(mirror.fields.description), /note:n-1#L3/);
    // Only what the domain may assert crosses: no status, no assignee, no
    // priority — asked of the authority map, not of a list kept here.
    assert.deepEqual(projectionFieldsByAuthority(mirror).tracker, []);
  });
});

test('team mode records no mirror and behaves exactly as before', async () => {
  await withStore(async (store) => {
    seed(store);
    decideProposal(store, 'p-1', 'approved', 'yes', AT);
    const result = await applyProposal(store, applier({ applied: true, detail: 'd' }), 'p-1', LATER);
    assert.equal(result.outcome, 'applied');
    assert.equal(result.outcome === 'applied' ? result.projected : 'set', undefined);
    assert.equal(countProjections(store), 0);
  });
});

test('a non-tracker source in seat mode records no mirror', async () => {
  await withStore(async (store) => {
    seed(store);
    setEngagementMode(store, 'acme', 'seat', AT);
    addSource(store, { id: 'src-2', workspace: 'acme', kind: 'docs', locator: 'confluence:space:WIKI', addedAt: AT });
    proposeWrite(store, {
      id: 'p-2',
      workspace: 'acme',
      run: 'run-1',
      source: 'src-2',
      change: 'retitle the onboarding page',
      justification: 'note:n-1#L4',
      risk: 'low',
      proposedAt: AT,
    });
    decideProposal(store, 'p-2', 'approved', 'yes', AT);
    await applyProposal(store, applier({ applied: true, detail: 'd' }), 'p-2', LATER);
    assert.equal(countProjections(store), 0);
  });
});

test('a host that declines leaves the mirror row: it records what was proposed, not a landing', async () => {
  await withStore(async (store) => {
    seed(store);
    setEngagementMode(store, 'acme', 'seat', AT);
    decideProposal(store, 'p-1', 'approved', 'yes', AT);
    const result = await applyProposal(
      store,
      applier({ applied: false, detail: 'no Jira connector here' }),
      'p-1',
      LATER,
    );
    assert.equal(result.outcome, 'unappliable');
    assert.equal(result.outcome === 'unappliable' ? result.projected : '', 'jira:p-1');
    const mirror = getProjection(store, 'jira:p-1');
    assert.ok(mirror, 'the record precedes the crossing, so it survives a refusal');
    assert.equal(mirror.state, 'projected', 'a decline is not a landing');
    assert.equal(mirror.reconciledAt, null);
    assert.equal(decisionOf(store, 'p-1')?.verdict, 'approved', 'the proposal state is untouched');
  });
});

test('a proposal that is refused before the host records no mirror', async () => {
  await withStore(async (store) => {
    seed(store);
    setEngagementMode(store, 'acme', 'seat', AT);
    const result = await applyProposal(store, applier({ applied: true, detail: 'd' }), 'p-1', LATER);
    assert.equal(result.outcome, 'refused');
    assert.equal(countProjections(store), 0, 'nothing undecided reaches the mirror');
  });
});

test('an approval recorded through an MCP surface does not satisfy the apply gate', async () => {
  await withStore(async (store) => {
    seed(store);
    // A model wrote a byte-identical `approved` row, stamped with its own
    // provenance. The queue and the record look exactly like a person's yes.
    decideProposal(store, 'p-1', 'approved', 'looks fine to me', AT, 'mcp:acme-agent');
    const result = await applyProposal(
      store,
      applier({ applied: true, detail: 'moved it' }),
      'p-1',
      LATER,
    );
    assert.equal(result.outcome, 'refused', 'a forged approval is not carried out');
    assert.match(result.outcome === 'refused' ? result.reason : '', /mcp:acme-agent|not a person/);
    assert.notEqual(decisionOf(store, 'p-1')?.verdict, 'applied', 'nothing was recorded applied');
  });
});

test('the same proposal, approved at the CLI, does satisfy the apply gate', async () => {
  await withStore(async (store) => {
    seed(store);
    decideProposal(store, 'p-1', 'approved', 'yes, move it', AT);
    const result = await applyProposal(
      store,
      applier({ applied: true, detail: 'moved it' }),
      'p-1',
      LATER,
    );
    assert.equal(result.outcome, 'applied', 'a human approval is honored');
  });
});
