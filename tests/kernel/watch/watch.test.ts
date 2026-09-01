/**
 * tests/kernel/watch/watch.test.ts — a watch is an outcome that never closes.
 *
 * The behaviors worth holding are the ones that decide whether a standing
 * watch is usable at all. A finding is raised once, so the second sweep that
 * sees the same divergence stays quiet; a sweep records itself even when it
 * finds nothing, so a watch that stopped running is distinguishable from a
 * watch with nothing to say; and a raised finding carries the whole risk
 * assessment, because an alert that says "these disagree" hands the user back
 * the work they were delegating.
 *
 * There is deliberately no test that a watch resolves or closes anything. It
 * cannot: only the user resolves a decision, and a finding that stops
 * appearing is not the same as a finding that was settled.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { openDecisions, getDecision, resolveDecision } from '../../../src/kernel/store/decisions.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { startWatch, sweepWatch, watchRun } from '../../../src/kernel/watch/watch.ts';
import type { Finding, Watch } from '../../../src/kernel/watch/watch.ts';
import { main } from '../../../src/cli/index.ts';

const AT = '2026-08-05T00:00:00.000Z';
const LATER = '2026-08-06T00:00:00.000Z';
const WATCH: Watch = { id: 'construct', ground: 'the tracker and the repo agreeing' };

const FINDING: Finding = {
  key: 'drift:bead-one:landed',
  trigger: 'tracker and repo disagree about bead-one',
  question: 'Is this closed bead work that actually landed?',
  branches: [
    { role: 'as-recorded', stance: 'the program counts capability it may not have', citation: 'no commit names it' },
    { role: 'as-corrected', stance: 'a session re-does work that already landed', citation: 'no commit names it' },
    { role: 'reversible-default', stance: 'record why and leave it closed', citation: null },
  ],
  wouldHaveCaught: 'program-sequencing',
};

function withStore<T>(body: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  try {
    return body(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

test('a finding is raised once, and a later sweep that still sees it stays quiet', () => {
  withStore((store) => {
    startWatch(store, WATCH, AT);

    const first = sweepWatch(store, { watch: WATCH, findings: [FINDING], at: AT });
    assert.deepEqual(first.raised, [FINDING.key]);
    assert.deepEqual(first.standing, []);
    assert.equal(openDecisions(store).length, 1);

    const second = sweepWatch(store, { watch: WATCH, findings: [FINDING], at: LATER });
    assert.deepEqual(second.raised, []);
    assert.deepEqual(second.standing, [FINDING.key]);
    assert.equal(openDecisions(store).length, 1, 'the inbox must not fill with one finding');
  });
});

test('a resolved finding is not raised again by the next sweep', () => {
  withStore((store) => {
    sweepWatch(store, { watch: WATCH, findings: [FINDING], at: AT });
    const id = openDecisions(store)[0].id;
    resolveDecision(store, id, 'Predates the trailer convention; leaving it closed.', AT, 'cli:user');

    const after = sweepWatch(store, { watch: WATCH, findings: [FINDING], at: LATER });
    assert.deepEqual(after.raised, [], 'a settled call must not come back');
    assert.equal(openDecisions(store).length, 0);
    assert.equal(getDecision(store, id)?.state, 'resolved');
  });
});

test('every sweep records itself, so a stopped watch is not mistaken for a quiet one', () => {
  withStore((store) => {
    sweepWatch(store, { watch: WATCH, findings: [], at: AT });
    const swept = readWorkLog(store, watchRun(WATCH)).filter((e) => e.action === 'watch-swept');
    assert.equal(swept.length, 1);
    assert.deepEqual(swept[0].detail, {
      watch: 'construct',
      ground: WATCH.ground,
      found: 0,
      raised: 0,
      standing: 0,
    });
    assert.equal(openDecisions(store).length, 0, 'a quiet sweep raises nothing');
  });
});

test('a raised finding carries the whole risk assessment, not just the disagreement', () => {
  withStore((store) => {
    sweepWatch(store, { watch: WATCH, findings: [FINDING], at: AT });
    const decision = openDecisions(store)[0];

    // The trigger pattern is in the question, because the question is all a
    // user reads before deciding whether to care.
    assert.match(decision.question, /tracker and repo disagree about bead-one/);
    assert.match(decision.question, /Is this closed bead work that actually landed\?/);

    const roles = decision.positions.map((p) => p.role);
    // Stakes down each branch, the reversible default, and the concern that
    // would normally have caught it.
    assert.deepEqual(roles, [
      'as-recorded',
      'as-corrected',
      'reversible-default',
      'program-sequencing',
    ]);
    assert.equal(
      decision.positions.filter((p) => p.citation !== null).length,
      2,
      'the branches cite the evidence that was actually checked',
    );
  });
});

test('the watch lives on the spine: its run is a run, and its log is the work log', () => {
  withStore((store) => {
    const run = startWatch(store, WATCH, AT);
    sweepWatch(store, { watch: WATCH, findings: [FINDING], at: AT });

    assert.equal(run, 'watch-construct');
    const actions = readWorkLog(store, run).map((e) => e.action);
    assert.deepEqual(actions, ['watch-started', 'watch-found', 'watch-swept']);
    assert.equal(openDecisions(store)[0].run, run, 'findings hang off the watch run');
  });
});

test('bare construct watch refuses and points at npm run reconcile', async () => {
  const err: string[] = [];
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: string) => {
    err.push(String(chunk));
    return true;
  };
  try {
    assert.equal(await main(['watch']), 2);
    const printed = err.join('');
    assert.match(printed, /npm run reconcile/);
    assert.match(printed, /watch add/);
  } finally {
    (process.stderr as { write: unknown }).write = realErr;
  }
});
