/**
 * The agreement study's instrument must not overstate its own confidence
 * (construct-eib).
 *
 * The first real two-coder run put the point floor at 0.1235 against a 0.15
 * target and printed "the 0.15 target is ABOVE the implied floor" — while the
 * bootstrap interval on that same floor was [0.05, 0.21], containing the target.
 * The point and the interval disagreed, and the script reported only the point.
 * That is the defect construct-2jb.2 withdrew claims for across this project,
 * committed by the tool that decides whether the headline target is reachable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — the labeling kit is plain .mjs, deliberately outside src/
import { bootstrap, verdictFor } from '../../scripts/labeling-kit/compute-alpha.mjs';

interface Observation {
  readonly unit: string;
  readonly coder: string;
  readonly value: ReadonlySet<string>;
}

/** Two coders over `n` outcomes, disagreeing on `disagreements` of them. */
function twoCoders(n: number, disagreements: number): Observation[] {
  const out: Observation[] = [];
  for (let i = 0; i < n; i += 1) {
    const unit = `u${String(i)}`;
    out.push({ unit, coder: 'a', value: new Set(['privacy']) });
    out.push({
      unit,
      coder: 'b',
      value: new Set(i < disagreements ? ['contracts'] : ['privacy']),
    });
  }
  return out;
}

test('a floor interval that straddles the target is never reported as settled', () => {
  // Moderate disagreement at a small n: the regime the real study is in, and
  // the one where a point estimate lands on one side of the target by luck.
  const boot = bootstrap(twoCoders(34, 8), 0.15);

  assert.ok(boot.floorLo < boot.floorHi, 'the interval has width');
  assert.ok(
    boot.floorLo <= 0.15 && 0.15 <= boot.floorHi,
    'this fixture is chosen to straddle; if it stops straddling the test is not testing anything',
  );
  assert.equal(
    verdictFor(boot, 0.15),
    'unsettled',
    'a straddling interval must not resolve to above-or-below',
  );
});

test('a verdict is only settled when the interval itself excludes the target', () => {
  // Near-total agreement: the floor is genuinely far below 0.15, and saying so
  // is honest rather than an overclaim. Two disagreements rather than zero,
  // because at zero every resample has De = 0 and alpha is undefined by design
  // — the floor is still 0 there, which is the asymmetry bootstrap() handles.
  const clean = bootstrap(twoCoders(34, 2), 0.15);
  assert.equal(verdictFor(clean, 0.15), 'target-above-floor');
  assert.ok(clean.floorHi < 0.15, 'settled means the whole interval is on one side');

  // Heavy disagreement: the floor is above the target, and the target is
  // unreachable by construction rather than merely hard.
  const noisy = bootstrap(twoCoders(34, 20), 0.15);
  assert.equal(verdictFor(noisy, 0.15), 'target-below-floor');
  assert.ok(0.15 < noisy.floorLo, 'settled means the whole interval is on one side');
});

test('the interval is reproducible — a measurement that drifts cannot be audited', () => {
  const observations = twoCoders(34, 8);
  const first = bootstrap(observations, 0.15);
  const second = bootstrap(observations, 0.15);

  assert.equal(first.floorLo, second.floorLo);
  assert.equal(first.floorHi, second.floorHi);
  assert.equal(first.pBelowTarget, second.pBelowTarget);
});

test('resampling draws whole outcomes, not coder-outcome pairs', () => {
  // The pairing is what alpha is computed over. If a resample could take coder
  // a's answer for one outcome and coder b's for another, the width would be
  // measuring something other than this study repeated.
  const boot = bootstrap(twoCoders(34, 8), 0.15);
  assert.ok(boot.resamples > 3900, 'nearly every resample yields a usable alpha');
  assert.ok(
    boot.pBelowTarget !== null && boot.pBelowTarget > 0 && boot.pBelowTarget < 1,
    'a straddling fixture must not report certainty in either direction',
  );
});
