/**
 * tests/cli/decide.test.ts — resolving a decision through the real CLI
 * surface, and what that resolution now leaves behind.
 *
 * Two properties live here. A resolved cross-domain decision becomes a
 * candidate lesson automatically, citing the decision rather than any note,
 * and the admission gate holds it for a human exactly as it holds an
 * ingested external document — never silently admitted for having come from
 * inside the system. And an outward change waiting in the queue is decided
 * from this surface rather than by opening the database: approving one always
 * records a human approval, a workspace's standing consent covers the
 * low-risk class and nothing else, and a high-risk change waits for a person
 * however that consent is set.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consent, decide } from '../../src/cli/index.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import type { Store } from '../../src/kernel/store/open.ts';
import { raiseDecision } from '../../src/kernel/store/decisions.ts';
import { lessonsFor } from '../../src/kernel/store/lessons.ts';
import { admissionOf, operationalLessonsFor } from '../../src/kernel/lessons/admission.ts';
import {
  addSource,
  decideProposal,
  decisionOf,
  proposeWrite,
  setEngagementMode,
} from '../../src/kernel/store/sources.ts';
import { getProjection } from '../../src/kernel/store/projections.ts';
import type { HostAdapter } from '../../src/kernel/hosts/interface.ts';

const AT = '2026-08-13T00:00:00.000Z';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(fn: () => Promise<number>): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-decide-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    code = await fn();
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * A host that can carry a change out, and counts the times it was asked —
 * a refusal that is supposed to happen before the host is reached is only
 * proved by the host never having been reached.
 */
function outwardHost(detail: string): HostAdapter & { readonly asked: () => number } {
  let asked = 0;
  return {
    name: 'stand-in',
    kind: 'coding',
    capabilities: ['outward-write'],
    init: async () => {},
    invoke: async () => {
      asked += 1;
      return {
        id: 'i-1',
        status: 'ok',
        output: { text: JSON.stringify({ applied: true, detail }) },
        error: null,
      };
    },
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    asked: () => asked,
  };
}

/** One tracker source and one waiting change per risk class, in workspace acme. */
function seedQueue(store: Store): void {
  addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: AT });
  proposeWrite(store, {
    id: 'p-low',
    workspace: 'acme',
    run: 'run-1',
    source: 'src-1',
    change: 'move PROJ-14 target date to Q4',
    justification: 'note:n-1#L3',
    risk: 'low',
    proposedAt: AT,
  });
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
}

test('resolving a decision distills it into a held, run-derived lesson', async () => {
  let checked = false;
  const { code, out } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    raiseDecision(store, {
      id: 'run-x:stance',
      run: 'run-x',
      question: 'mobile-launch-completion or UGC first?',
      positions: [
        { role: 'strategy-alignment', stance: 'mobile-launch-completion first', citation: 'task:t-1#L1' },
        { role: 'product-scoping', stance: 'UGC first', citation: 'task:t-2#L1' },
      ],
      raisedAt: '2026-08-13T00:00:00.000Z',
    });
    store.close();
    const result = await decide(['run-x:stance', 'mobile-launch-completion first; UGC waits']);

    // Inspected inside run()'s callback, before its finally block restores
    // XDG_DATA_HOME — the store this test wrote lives at the temp path, not
    // wherever the environment points once the harness has cleaned up.
    const check = openStore(storePath(resolvePaths()));
    const lessons = lessonsFor(check, 'run-x');
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].citation, 'decision:run-x:stance');
    assert.match(lessons[0].body, /mobile-launch-completion or UGC first\?/);
    assert.equal(admissionOf(check, 'lesson-run-x:stance')?.verdict, 'held');
    assert.deepEqual(operationalLessonsFor(check, 'run-x'), [], 'never auto-admitted');
    check.close();
    checked = true;

    return result;
  });

  assert.equal(code, 0);
  assert.ok(checked);
  assert.match(out, /decided run-x:stance/);
  assert.match(out, /distilled lesson-run-x:stance \(held\)/);
  assert.match(out, /own resolved decision/);
});

test('an open decision left unresolved leaves no lesson behind', async () => {
  const { code } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    raiseDecision(store, {
      id: 'run-y:stance',
      run: 'run-y',
      question: 'q',
      positions: [
        { role: 'strategy-alignment', stance: 'a', citation: 'task:t-1#L1' },
        { role: 'product-scoping', stance: 'b', citation: 'task:t-2#L1' },
      ],
      raisedAt: '2026-08-13T00:00:00.000Z',
    });
    assert.deepEqual(lessonsFor(store, 'run-y'), []);
    store.close();
    return 0;
  });
  assert.equal(code, 0);
});

test('an apply in seat mode prints the mirror it recorded before the change crossed', async () => {
  const host = outwardHost('moved PROJ-14 to Q4');

  let mirrored = false;
  const { code, out } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: AT });
    setEngagementMode(store, 'acme', 'seat', AT);
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
    decideProposal(store, 'p-1', 'approved', 'yes, move it', AT);
    store.close();

    const result = await decide(['--apply=p-1'], host);

    const check = openStore(storePath(resolvePaths()));
    mirrored = getProjection(check, 'jira:p-1') !== null;
    check.close();
    return result;
  });

  assert.equal(code, 0);
  assert.ok(mirrored, 'the crossing is on the mirror');
  assert.match(out, /mirrored as jira:p-1 before it crossed/);
  assert.match(out, /applied p-1: moved PROJ-14 to Q4/);
});

test('the waiting queue is listable, and approving one records a human approval', async () => {
  let recorded: { verdict: string; basis: string } | null = null;
  const { code, out } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    seedQueue(store);
    store.close();

    const listed = await decide(['--pending', '--workspace=acme']);
    assert.equal(listed, 0);

    const approved = await decide(['--approve=p-low', 'yes, the date slipped']);

    const check = openStore(storePath(resolvePaths()));
    const decision = decisionOf(check, 'p-low');
    recorded = decision ? { verdict: decision.verdict, basis: decision.basis } : null;
    check.close();
    return approved;
  });

  assert.equal(code, 0);
  // The listing names the change, what justifies it, and its risk, because a
  // change you cannot read is one you cannot decide.
  assert.match(out, /outward changes waiting in workspace acme \(2\)/);
  assert.match(out, /p-low {2}\[low risk] {2}PROJ/);
  assert.match(out, /move PROJ-14 target date to Q4/);
  assert.match(out, /justified by note:n-1#L3/);
  assert.match(out, /p-high {2}\[high risk]/);
  assert.match(out, /high risk is never covered by it/);
  assert.match(out, /approved p-low: yes, the date slipped/);
  // Approving decides; it does not write anything outward.
  assert.match(out, /Nothing has been written outward yet/);
  assert.deepEqual(recorded, { verdict: 'approved', basis: 'human-approval' });
});

test('a rejected change is never carried out, and an unknown one is a sentence, not a stack', async () => {
  const host = outwardHost('moved it anyway');
  let standing: string | undefined;
  const { out, err } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    seedQueue(store);
    store.close();

    assert.equal(await decide(['--reject=p-low', 'the date is right as it stands']), 0);
    assert.equal(await decide(['--apply=p-low'], host), 1);
    assert.equal(await decide(['--approve=p-nope', 'sure']), 1);
    // A decision with no reason is the audit line the queue exists to keep.
    assert.equal(await decide(['--approve=p-high']), 2);

    const check = openStore(storePath(resolvePaths()));
    standing = decisionOf(check, 'p-low')?.verdict;
    check.close();
    return 0;
  });

  assert.equal(host.asked(), 0, 'a rejected change is not even attempted');
  assert.equal(standing, 'rejected', 'the rejection stands');
  assert.match(out, /rejected p-low: the date is right as it stands/);
  assert.ok(!/Nothing has been written outward yet/.test(out), 'a rejection has no next step');
  assert.match(err, /rejection is not overridden/);
  assert.match(err, /no outward change p-nope is waiting/);
  assert.match(err, /needs the change and your reason/);
  assert.ok(!/ {4}at /.test(err), 'no stack frames');
});

test('standing consent carries a low-risk change out, and never a high-risk one', async () => {
  const host = outwardHost('moved PROJ-14 to Q4');
  let bases: Array<string | undefined> = [];
  const { out, err } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    seedQueue(store);
    store.close();

    assert.equal(consent(['--workspace=acme', '--set=on']), 0);
    // Neither change has a decision of its own: the low-risk one goes out on
    // the workspace's standing yes, the high-risk one stops regardless.
    assert.equal(await decide(['--apply=p-low'], host), 0);
    assert.equal(await decide(['--apply=p-high'], host), 1);

    const check = openStore(storePath(resolvePaths()));
    bases = [decisionOf(check, 'p-low')?.basis, decisionOf(check, 'p-high')?.basis];
    check.close();
    return 0;
  });

  assert.equal(host.asked(), 1, 'the high-risk change never reached the host');
  assert.deepEqual(bases, ['standing-consent', undefined]);
  assert.match(out, /workspace acme: standing consent on/);
  // Turning it on states its limit rather than leaving it to a later refusal.
  assert.match(out, /High-risk changes are never covered by it/);
  assert.match(out, /applied p-low: moved PROJ-14 to Q4/);
  assert.match(err, /a high-risk change is never carried out on standing consent/);
});

test('a workspace has no standing consent until it says so, and the listing says which', async () => {
  const { code, out } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    seedQueue(store);
    store.close();

    assert.equal(consent(['--workspace=acme']), 0);
    assert.equal(await decide(['--pending', '--workspace=acme']), 0);
    assert.equal(consent(['--workspace=acme', '--set=on']), 0);
    return decide(['--pending', '--workspace=acme']);
  });

  assert.equal(code, 0);
  assert.match(out, /workspace acme: standing consent off/);
  assert.match(out, /every outward change waits for your decision/);
  assert.match(out, /waits for your decision/);
  assert.match(out, /covered by this workspace standing consent for low-risk changes/);
});

test('an unreadable consent setting is a usage error, not a silent no', async () => {
  const { code, err } = await run(async () => consent(['--workspace=acme', '--set=maybe']));
  assert.equal(code, 2);
  assert.match(err, /usage: construct consent/);
});
