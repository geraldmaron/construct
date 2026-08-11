/**
 * tests/kernel/run/conflict-quality.test.ts — the disagreement machinery,
 * measured on a concern pair it was not built against.
 *
 * Commitment 11's machinery was measured on the concerns that existed when it
 * was written. Strategy-alignment and system-design are the natural pair to
 * test it against now, because their arguments do not reduce to each other:
 * the bet argues for speed, the architecture argues for what stays reversible,
 * and both are real. A run that surfaces only one of them has lost something a
 * reader needed rather than merely been brief.
 *
 * The failure these tests exist to catch is the one that looks like success. A
 * run where one role declares a stance and the other stays silent frames no
 * decision, empties no inbox, and reads as a clean run — and a check that only
 * asked "did anything go wrong" would agree with it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { frameConflict } from '../../../src/kernel/run/conflicts.ts';
import type { RoleStance } from '../../../src/kernel/run/conflicts.ts';

const AT = '2026-08-10T00:00:00.000Z';

function stance(
  role: string,
  word: 'proceed' | 'hold' | 'unclear',
  because: string,
  citation: string | null,
): RoleStance {
  return { role, declared: { stance: word, qualifier: null, because, citation } };
}

function score(fixture: string): { code: number; result: Record<string, unknown> } {
  const run = spawnSync(
    process.execPath,
    ['scripts/check-conflict-quality.mjs', '--fixture', `fixtures/conflict-quality/${fixture}.json`, '--json'],
    { encoding: 'utf8' },
  );
  return { code: run.status ?? -1, result: JSON.parse(run.stdout) };
}

test('the new concern pair frames with both sides cited and a reversible default', () => {
  const decision = frameConflict({
    run: 'run-1',
    outcome: 'migrate billing this quarter',
    at: AT,
    stances: [
      stance('strategy-alignment', 'proceed', 'the renewal window is the constraint', 'strategy.md'),
      stance('system-design', 'hold', 'the boundary change is one-way', 'rfc-002-manifest-hydrator.md'),
    ],
  });
  assert.ok(decision);
  const roles = decision.positions.map((p) => p.role);
  assert.deepEqual(roles, ['strategy-alignment', 'system-design', 'construct']);
  assert.equal(decision.positions[0].citation, 'strategy.md');
  assert.equal(decision.positions[1].citation, 'rfc-002-manifest-hydrator.md');
  assert.match(decision.positions[2].stance, /reversible default if you do nothing/);
});

test('the default names its authors, so it is not the tool speaking', () => {
  const decision = frameConflict({
    run: 'run-1',
    outcome: 'migrate billing this quarter',
    at: AT,
    stances: [
      stance('strategy-alignment', 'proceed', 'the window', 'strategy.md'),
      stance('system-design', 'hold', 'one-way', 'rfc-002.md'),
    ],
  });
  // A default with no author reads as the tool's own view, which is the
  // arbitration commitment 11 forbids. Naming who argued each way is what
  // keeps "this holds" a report of the sides rather than a verdict on them.
  assert.match(decision!.positions[2].stance, /system-design argued for it/);
  assert.match(decision!.positions[2].stance, /strategy-alignment argued against/);
  assert.match(decision!.positions[2].stance, /not a preference/);
});

test('the stance is read from the deliverable of record, not from the reply', async () => {
  // Observed on a live run: a role submitted a 9,000-character deliverable
  // citing three files through the write surface, then replied with a summary
  // whose restated stance block carried the word and dropped the BECAUSE and
  // CITE lines. The framing read the reply, so the inbox showed that role's
  // position with no reason and no citation while its deliverable had both —
  // and "both sides cited" is the one thing commitment 11 asks of a framed
  // conflict. The challenge checks had already learned this lesson; the stance
  // parser had not.
  const { openStore } = await import('../../../src/kernel/store/open.ts');
  const { enqueueTask, claimTask, completeTask } = await import('../../../src/kernel/store/tasks.ts');
  const { DRAFT_ACTION } = await import('../../../src/kernel/run/promotion.ts');
  const { appendWorkLog } = await import('../../../src/kernel/store/worklog.ts');
  const { frameConflicts } = await import('../../../src/kernel/run/coordinator.ts');
  const { openDecisions } = await import('../../../src/kernel/store/decisions.ts');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const root = mkdtempSync(join(tmpdir(), 'construct-stance-'));
  const store = openStore(join(root, 'construct.db'));
  try {
    const seed = (role: string, reply: string, draft: string): void => {
      const id = `run-1:${role}`;
      enqueueTask(store, {
        id,
        run: 'run-1',
        role,
        brief: { id, outcome: 'ship it', role, inputs: [], capabilities: [], postconditions: [] },
        at: AT,
      });
      const leased = claimTask(store, { owner: 'test', leaseUntil: '2099-01-01T00:00:00.000Z', now: AT, run: 'run-1' });
      completeTask(store, {
        id: leased!.id,
        owner: 'test',
        token: leased!.token,
        result: { text: reply },
        spend: 0,
        spendReported: false,
        at: AT,
      });
      appendWorkLog(store, {
        run: 'run-1',
        task: leased!.id,
        role,
        action: DRAFT_ACTION,
        // A submitted draft arrives as a plain string on the real path.
        detail: { deliverable: draft },
        at: AT,
      });
    };

    seed(
      'security',
      'Summary of what I found.\n\nSTANCE: proceed — bounded exposures, worth filing as follow-up.',
      'FINDING\nthe store is deletable\n\nSTANCE: proceed\nBECAUSE: the exposures are bounded\nCITE: src/kernel/cleanup/catalog.ts',
    );
    seed(
      'operations',
      'Summary.\n\nSTANCE: hold\nBECAUSE: no detection path\nCITE: docs/first-run.md',
      'FINDING\nnobody finds out\n\nSTANCE: hold\nBECAUSE: no detection path\nCITE: docs/first-run.md',
    );

    assert.equal(frameConflicts(store, [], { clock: () => AT, run: 'run-1' }), 1);
    const decision = openDecisions(store, 'run-1')[0];
    const security = decision.positions.find((p) => p.role === 'security');
    assert.equal(
      security?.citation,
      'src/kernel/cleanup/catalog.ts',
      'the citation lives in the deliverable, so the framing has to read the deliverable',
    );
    assert.match(security!.stance, /the exposures are bounded/);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the two-sided run passes every check', () => {
  const { code, result } = score('two-sided');
  assert.equal(code, 0, JSON.stringify(result.checks));
  assert.equal(result.pass, true);
});

test('one voice and an empty inbox is a failure, not a clean run', () => {
  const { code, result } = score('one-voice');
  assert.equal(code, 1);
  const checks = result.checks as { id: string; pass: boolean; detail: string }[];
  assert.equal(checks.find((c) => c.id === 'both-sides-declared')?.pass, false);
  assert.equal(checks.find((c) => c.id === 'decision-carries-both')?.pass, false);
});

test('two sides citing one document is one reading, not two concerns', () => {
  const { code, result } = score('same-evidence');
  assert.equal(code, 1);
  const checks = result.checks as { id: string; pass: boolean; detail: string }[];
  assert.equal(checks.find((c) => c.id === 'each-cites-its-own')?.pass, false);
  assert.match(checks.find((c) => c.id === 'each-cites-its-own')!.detail, /same evidence/);
});

test('a framing with no reversible default fails on exactly that', () => {
  const { code, result } = score('no-default');
  assert.equal(code, 1);
  const checks = result.checks as { id: string; pass: boolean }[];
  // Everything else about this run is right, which is the point: the failure
  // is isolated to the missing default rather than smeared across the run.
  assert.equal(checks.find((c) => c.id === 'both-sides-declared')?.pass, true);
  assert.equal(checks.find((c) => c.id === 'each-cites-its-own')?.pass, true);
  assert.equal(checks.find((c) => c.id === 'reversible-default')?.pass, false);
});
