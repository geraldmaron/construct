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
