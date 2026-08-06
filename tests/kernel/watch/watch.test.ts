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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/cli/index.ts';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { openDecisions, getDecision, resolveDecision } from '../../../src/kernel/store/decisions.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { startWatch, sweepWatch, watchRun } from '../../../src/kernel/watch/watch.ts';
import type { Finding, Watch } from '../../../src/kernel/watch/watch.ts';
import { constructFindings } from '../../../src/kernel/watch/construct-ground.ts';
import type { SessionDriftReport } from '../../../src/kernel/tracker/session-drift.ts';

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
    resolveDecision(store, id, 'Predates the trailer convention; leaving it closed.', AT);

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

test('drift and self-contradiction both become findings, keyed so they stay stable', () => {
  const report = {
    ok: false,
    counts: { total: 2, inSync: 0, absorbed: 0, drifted: 1, missing: 0 },
    drifted: [
      {
        external_id: 'bead-one',
        conflicts: [{ field: 'landed', domain: false, tracker: true }],
      },
      // A bead that drifted on both fields is one situation, resolved once.
      {
        external_id: 'bead-two',
        conflicts: [
          { field: 'in_flight', domain: false, tracker: true },
          { field: 'landed', domain: true, tracker: false },
        ],
      },
    ],
    missing: [],
    contradictions: [
      {
        external_id: 'bead-three',
        rule: 'human-labelled-bead-is-in-progress',
        detail: 'release the claim and set status back to open',
      },
    ],
    clean: false,
  } as unknown as SessionDriftReport;

  const findings = constructFindings(report);
  assert.equal(findings.length, 3);
  assert.deepEqual(findings.map((f) => f.key), [
    'drift:bead-one:landed',
    'drift:bead-two:in_flight+landed',
    'contradiction:bead-three:human-labelled-bead-is-in-progress',
  ]);

  // Every finding states a reversible default and names who would have caught it.
  for (const finding of findings) {
    const fallback = finding.branches.find((b) => b.role === 'reversible-default');
    assert.ok(fallback, 'every finding names the branch that is safe by default');
    assert.match(fallback.stance, /[Rr]eversible|open/);
    assert.equal(finding.wouldHaveCaught, 'program-sequencing');
    assert.ok(finding.trigger.length > 0 && finding.question.endsWith('?'));
  }

  // The two directions of the same field call for opposite fixes, and the
  // framing must not describe them identically.
  const closedNoCommit = constructFindings({
    ...report,
    drifted: [{ external_id: 'x', conflicts: [{ field: 'landed', domain: false, tracker: true }] }],
    contradictions: [],
  } as unknown as SessionDriftReport)[0];
  const openWithCommit = constructFindings({
    ...report,
    drifted: [{ external_id: 'x', conflicts: [{ field: 'landed', domain: true, tracker: false }] }],
    contradictions: [],
  } as unknown as SessionDriftReport)[0];
  assert.notEqual(closedNoCommit.question, openWithCommit.question);
});

test('the watch surface reaches a real repo through the CLI, and a second sweep is quiet', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-watch-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  // The fixture is a repository this test builds, not the checkout the suite
  // happens to run in: a shallow tag checkout (CI on a release) has no main
  // branch, and watch correctly calls that unwatched ground — which is a fact
  // about the checkout, not about this surface.
  const ground = join(root, 'watched-repo');
  mkdirSync(ground, { recursive: true });
  const git = (...argv: string[]): void => {
    execFileSync('git', ['-C', ground, ...argv], { stdio: 'ignore' });
  };
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'first');
  // Watched ground needs a tracker export beside the repo; empty is a valid
  // tracker state and keeps the fixture about the surface, not the data.
  mkdirSync(join(ground, '.beads'), { recursive: true });
  writeFileSync(join(ground, '.beads', 'issues.jsonl'), '');
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  (process.stderr as { write: unknown }).write = () => true;
  try {
    // A directory that is not a repository is unwatched ground, not a broken
    // tool, and the exit code says which.
    assert.equal(await main(['watch', `--root=${join(root, 'share')}`]), 1);

    assert.equal(await main(['watch', `--root=${ground}`]), 0);
    const first = out.join('');
    assert.match(first, /watch construct/);
    out.length = 0;

    assert.equal(await main(['watch', `--root=${ground}`]), 0);
    const second = out.join('');
    assert.doesNotMatch(second, /raised as new decisions\n {2}new /);
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
