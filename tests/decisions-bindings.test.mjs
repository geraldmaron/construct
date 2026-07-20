/**
 * tests/decisions-bindings.test.mjs — decision durability gate (bead wvbf.2).
 *
 * @enforces ADR-0015
 *
 * The ratchet: a decision in the enforced baseline must stay enforced, and every
 * binding marker must resolve to a real decision. These tests pin both the happy
 * path (the live tree is intact) and the failure paths (a dropped binding and a
 * marker pointing nowhere are caught), so the gate cannot silently pass.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkBindings, enforcedIds, buildRegistry } from '../lib/decisions/registry.mjs';

// Routing handoff ids migrated from the decision registry into capability
// contracts (see tests/decisions-registry.test.mjs). The enforced baseline
// may list ids absent from the decision registry; exclude them via
// RETIRED_CONTRACT_BASELINE_IDS.
const RETIRED_CONTRACT_BASELINE_IDS = new Set([
  'any-to-product-manager',
  'any-to-researcher',
  'architect-to-engineer-data',
  'architect-to-reviewer-eval',
  'architect-to-security',
  'product-manager-to-architect',
  'product-manager-to-data-analyst',
  'product-manager-to-researcher',
  'researcher-to-product-manager',
]);

test('live tree has no dangling markers and no enforcement regressions', () => {
  const { dangling, regressions } = checkBindings();
  const liveRegressions = regressions.filter((id) => !RETIRED_CONTRACT_BASELINE_IDS.has(id));
  assert.equal(dangling.length, 0, `dangling=${JSON.stringify(dangling)}`);
  assert.equal(liveRegressions.length, 0, `regressions=${JSON.stringify(liveRegressions)}`);
});

test('enforced baseline is a subset of currently-enforced decisions', () => {
  const { byId } = buildRegistry();
  const enforced = new Set(enforcedIds());
  const baseline = JSON.parse(
    readFileSync(new URL('../lib/decisions/enforced-baseline.json', import.meta.url), 'utf8'),
  ).enforced;
  for (const id of baseline) {
    if (RETIRED_CONTRACT_BASELINE_IDS.has(id) || !byId.has(id)) continue;
    assert.ok(enforced.has(id), `baseline decision ${id} must remain enforced`);
  }
});

test('a baseline decision losing its enforcement is flagged a regression', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-bindings-'));
  try {
    mkdirSync(join(dir, 'lib', 'decisions'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'decisions', 'enforced-baseline.json'), JSON.stringify({ enforced: ['ghost-decision'] }));
    const { ok, regressions } = checkBindings({ repoRoot: dir });
    assert.equal(ok, false);
    assert.ok(regressions.includes('ghost-decision'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a binding marker pointing at no decision is flagged dangling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-bindings-'));
  try {
    mkdirSync(join(dir, 'lib', 'decisions'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'decisions', 'enforced-baseline.json'), JSON.stringify({ enforced: [] }));
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, 'tests', 'x.test.mjs'), '// @enforces NOPE-9999\n');
    const { ok, dangling } = checkBindings({ repoRoot: dir });
    assert.equal(ok, false);
    assert.ok(dangling.some((d) => d.id === 'NOPE-9999'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
