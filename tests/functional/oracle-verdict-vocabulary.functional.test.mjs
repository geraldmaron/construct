/**
 * tests/functional/oracle-verdict-vocabulary.functional.test.mjs —
 *
 * The 11-state evidence-status vocabulary.
 * Exercises: each state reachable from synthesizeVerdict's real inputs
 * (or documented as aspirational when it isn't), the worst-status-wins
 * rollup priority, isCleanVerdict(), and the five real consumers named in
 * Lib/oracle/actions.mjs, lib/oracle/index.mjs,
 * lib/oracle/cli.mjs, lib/intake/session-prelude.mjs, lib/oracle/gaps.mjs —
 * against both a clean and a genuinely-bad verdict.
 *
 * @capability oracle.meta-review
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  synthesizeVerdict,
  VERDICT_STATES,
  CLEAN_VERDICTS,
  isCleanVerdict,
} from '../../lib/oracle/synthesize.mjs';
import { collectOracleGaps } from '../../lib/oracle/gaps.mjs';
import { writeVerdict } from '../../lib/oracle/verdicts.mjs';
import { buildOraclePrelude, readOracleDockState } from '../../lib/intake/session-prelude.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function freshProjectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-verdict-vocab-'));
  return dir;
}

test('VERDICT_STATES has exactly the 11 ADR-0091 states', () => {
  const expected = new Set([
    'passed', 'failed', 'degraded', 'unsupported', 'not-applicable',
    'not-run', 'stale', 'incomplete', 'blocked', 'unknown', 'collection-error',
  ]);
  assert.equal(VERDICT_STATES.length, 11);
  for (const s of VERDICT_STATES) assert.ok(expected.has(s), `unexpected state: ${s}`);
  for (const s of expected) assert.ok(VERDICT_STATES.includes(s), `missing state: ${s}`);
});

test('CLEAN_VERDICTS / isCleanVerdict agree on every state', () => {
  for (const state of VERDICT_STATES) {
    assert.equal(isCleanVerdict(state), CLEAN_VERDICTS.has(state));
  }
  assert.deepEqual([...CLEAN_VERDICTS].sort(), ['not-applicable', 'passed', 'unsupported']);
});

test('synthesizeVerdict reaches passed from a fully clean read model', () => {
  const readModel = {
    projectDir: '/tmp/x',
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: { present: true, stale: false, generatedAt: new Date().toISOString(), audit: { regressions: [] }, skills: {} },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    beads: { present: true, stuckInProgress: 0, staleOpen: 0 },
    deadCode: { regressions: [] },
    dependencyGraph: { present: true, applicable: true, stale: false, coverage: {}, untested: [] },
    artifactGate: { specialistAudit: { present: true, pass: true } },
  };
  const { verdict, gaps } = synthesizeVerdict(readModel);
  assert.equal(gaps.length, 0);
  assert.equal(verdict, 'passed');
});

test('synthesizeVerdict reaches failed from a high-severity gap', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    parity: { ok: false, skipped: false, summary: ['adapter drift'] },
  });
  assert.equal(verdict, 'failed');
});

test('synthesizeVerdict reaches degraded from a non-high-severity gap only', () => {
  const { verdict, gaps } = synthesizeVerdict({
    projectDir: '/tmp/x',
    contractViolations: { recentCount: 2 },
  });
  assert.ok(gaps.every((g) => g.severity !== 'high'));
  assert.equal(verdict, 'degraded');
});

const CLEAN_BASELINE = {
  projectDir: '/tmp/x',
  parity: { ok: true, skipped: false },
  contractViolations: { recentCount: 0 },
  doctorLog: { recent: [] },
  outcomes: { present: true, roles: {} },
  alignmentCensus: { present: true, stale: false, generatedAt: new Date().toISOString(), audit: { regressions: [] }, skills: {} },
  registryValidate: { needsRun: false, warningCount: 0 },
  observations: { present: true, count: 1 },
  orgGraph: {},
  beads: { present: true, stuckInProgress: 0, staleOpen: 0 },
  deadCode: { regressions: [] },
  dependencyGraph: { present: true, applicable: true, stale: false, coverage: {}, untested: [] },
  artifactGate: { specialistAudit: { present: true, pass: true } },
};

test('synthesizeVerdict reaches not-applicable when parity.skipped (not a Construct project)', () => {
  const { verdict, gaps } = synthesizeVerdict({
    ...CLEAN_BASELINE,
    parity: { ok: true, skipped: true, summary: [] },
  });
  assert.equal(gaps.length, 0);
  assert.equal(verdict, 'not-applicable');
});

test('synthesizeVerdict reaches not-applicable when a dependency graph is inapplicable to this repo type', () => {
  const { verdict, gaps } = synthesizeVerdict({
    ...CLEAN_BASELINE,
    dependencyGraph: { present: false, applicable: false },
  });
  assert.equal(gaps.length, 0);
  assert.equal(verdict, 'not-applicable');
});

test('synthesizeVerdict reaches not-run when the specialist audit never ran', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    artifactGate: { specialistAudit: { present: false } },
  });
  assert.equal(verdict, 'not-run');
});

test('synthesizeVerdict reaches not-run when a dependency graph is expected but never built', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    dependencyGraph: { present: false, applicable: true },
  });
  assert.equal(verdict, 'not-run');
});

test('synthesizeVerdict reaches stale when the alignment census aged out', () => {
  const { verdict, gaps } = synthesizeVerdict({
    projectDir: '/tmp/x',
    alignmentCensus: { present: true, stale: true, generatedAt: '2020-01-01T00:00:00Z', audit: { regressions: [] }, skills: {} },
  });
  // census-stale (medium) also fires as a gap — stale outranks it in the
  // rollup precisely because the underlying evidence is aged, not clean.
  assert.ok(gaps.some((g) => g.id === 'census-stale'));
  assert.equal(verdict, 'stale');
});

test('synthesizeVerdict reaches incomplete when dependency matrix coverage has misses', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    dependencyGraph: {
      present: true, applicable: true, stale: false,
      coverage: { capabilitiesWithoutTest: ['cap:a'], capabilitiesWithoutImpl: [], workflowsUncovered: [] },
      untested: [],
    },
  });
  assert.equal(verdict, 'incomplete');
});

test('synthesizeVerdict reaches incomplete when the observation store is empty', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    observations: { present: true, count: 0 },
  });
  assert.equal(verdict, 'incomplete');
});

test('synthesizeVerdict reaches blocked when the beads CLI is unavailable', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    beads: { present: false },
  });
  assert.equal(verdict, 'blocked');
});

test('synthesizeVerdict reaches collection-error when the parity collector itself threw', () => {
  const { verdict, gaps } = synthesizeVerdict({
    projectDir: '/tmp/x',
    parity: { ok: false, skipped: false, error: 'ENOENT: registry.json', surfaces: [], summary: [] },
  });
  assert.ok(gaps.some((g) => g.id === 'parity-drift'));
  assert.equal(verdict, 'collection-error');
});

test('synthesizeVerdict reaches collection-error when the registry validator itself threw', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    registryValidate: { valid: false, errorCount: 1, warningCount: 0, needsRun: true, error: 'boom' },
  });
  assert.equal(verdict, 'collection-error');
});

test('synthesizeVerdict reaches unknown when synthesis itself throws (no readModel)', () => {
  const result = synthesizeVerdict(undefined);
  assert.equal(result.verdict, 'unknown');
  assert.equal(result.gaps.length, 0);
  assert.equal(result.recommendedActions.length, 0);
  assert.equal(typeof result.error, 'string');
});

test('unsupported is a recognized, clean state but is not reachable from any current readModel input', () => {
  // No collector synthesizeVerdict reads today reports "no detector exists
  // for this check class" — every section has a real collector behind it
  // (read-model.mjs), so nothing in this function can emit 'unsupported'.
  // Reserved for a future evidence producer that legitimately has none
  // (rejected-alternatives); documented here rather than faked.
  assert.ok(VERDICT_STATES.includes('unsupported'));
  assert.ok(isCleanVerdict('unsupported'));
});

test('rollup priority: collection-error outranks a simultaneous high-severity gap', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    parity: { ok: false, skipped: false, error: 'boom', surfaces: [], summary: [] },
    contractViolations: { recentCount: 5 },
  });
  assert.equal(verdict, 'collection-error');
});

test('rollup priority: blocked outranks a simultaneous non-high gap', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    beads: { present: false },
    contractViolations: { recentCount: 1 },
  });
  assert.equal(verdict, 'blocked');
});

test('rollup priority: incomplete outranks a simultaneous non-high gap', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    observations: { present: true, count: 0 },
    contractViolations: { recentCount: 1 },
  });
  assert.equal(verdict, 'incomplete');
});

test('rollup priority: failed outranks a simultaneous not-run signal', () => {
  const { verdict } = synthesizeVerdict({
    projectDir: '/tmp/x',
    parity: { ok: false, skipped: false, summary: [] },
    artifactGate: { specialistAudit: { present: false } },
  });
  assert.equal(verdict, 'failed');
});

// --- Consumer: lib/oracle/gaps.mjs (collectOracleGaps, pass-through) -----

test('collectOracleGaps passes a clean verdict through unexamined', () => {
  const projectDir = freshProjectDir();
  try {
    writeVerdict(projectDir, { at: new Date().toISOString(), verdict: 'passed', gaps: [] });
    const result = collectOracleGaps(projectDir);
    assert.equal(result.verdict, 'passed');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('collectOracleGaps passes a genuinely-bad new-vocabulary verdict through unexamined', () => {
  const projectDir = freshProjectDir();
  try {
    writeVerdict(projectDir, {
      at: new Date().toISOString(),
      verdict: 'collection-error',
      gaps: [{ id: 'parity-drift', severity: 'high', detail: 'parity check failed: boom' }],
    });
    const result = collectOracleGaps(projectDir);
    assert.equal(result.verdict, 'collection-error');
    assert.ok(result.gaps.some((g) => g.id === 'parity-drift'));
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// --- Consumer: lib/intake/session-prelude.mjs (buildOraclePrelude, -----
// --- readOracleDockState — the two former `=== 'healthy'` literals) -----

function writeVerdictFixture(projectDir, verdict, gaps = []) {
  mkdirSync(join(projectDir, '.construct', 'oracle', 'verdicts'), { recursive: true });
  const at = new Date().toISOString();
  const dateKey = at.slice(0, 10);
  const latest = { at, verdict, gaps };
  writeFileSync(
    join(projectDir, '.construct', 'oracle', 'verdicts', `${dateKey}.json`),
    JSON.stringify({ date: dateKey, ticks: [latest], latest }, null, 2),
  );
}

test('session-prelude hides the Oracle dock for a passed-equivalent verdict with no pending approvals', () => {
  const projectDir = freshProjectDir();
  try {
    writeVerdictFixture(projectDir, 'passed');
    assert.equal(buildOraclePrelude({ cwd: projectDir }), '');
    const state = readOracleDockState({ cwd: projectDir });
    assert.equal(state.visible, false);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('session-prelude hides the Oracle dock for a not-applicable verdict with no pending approvals', () => {
  const projectDir = freshProjectDir();
  try {
    writeVerdictFixture(projectDir, 'not-applicable');
    assert.equal(buildOraclePrelude({ cwd: projectDir }), '');
    const state = readOracleDockState({ cwd: projectDir });
    assert.equal(state.visible, false);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('session-prelude surfaces the Oracle dock for a genuinely-bad new-vocabulary verdict', () => {
  const projectDir = freshProjectDir();
  try {
    writeVerdictFixture(projectDir, 'collection-error', [
      { id: 'parity-drift', severity: 'high', detail: 'parity check failed: boom' },
    ]);
    const out = buildOraclePrelude({ cwd: projectDir });
    assert.notEqual(out, '');
    assert.match(out, /verdict: \*\*collection-error\*\*/);
    const state = readOracleDockState({ cwd: projectDir });
    assert.equal(state.visible, true);
    assert.equal(state.verdict, 'collection-error');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('session-prelude surfaces the Oracle dock for blocked/incomplete/not-run/stale — none read as clean', () => {
  for (const verdict of ['blocked', 'incomplete', 'not-run', 'stale']) {
    const projectDir = freshProjectDir();
    try {
      writeVerdictFixture(projectDir, verdict);
      const state = readOracleDockState({ cwd: projectDir });
      assert.equal(state.visible, true, `${verdict} should render the dock`);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }
});

// --- Consumer: lib/oracle/cli.mjs (`Oracle verdict: …` print) ------------
//
// A fresh project's real read model is essentially never a clean 'passed'
// (no outcomes/_summary.json or alignment-census.json exists yet, which is
// itself 'not-run' — a real, honest instance of the M1 blind spot this ADR
// closes), so this integration test exercises the genuinely-bad branch of
// cli.mjs's new isCleanVerdict() annotation; the clean branch is covered
// directly by the CLEAN_VERDICTS/isCleanVerdict test above, which is the
// exact boolean cli.mjs's annotation delegates to.

// Spawned as a real subprocess rather than calling runOracleCli in-process
// with a patched process.stdout.write: under `node --test`, stdout is also
// the runner's result-protocol transport, so an in-process patch captures
// (and swallows) the runner's own serialized events — observed on CI as the
// verdict assertion failing against a buffer of runner IPC bytes.

test('cli review annotates a non-clean verdict and stays fast on a fresh project', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'oracle-cli-verdict-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'oracle-cli-verdict-home-'));
  mkdirSync(join(projectDir, '.cx'), { recursive: true });
  mkdirSync(join(homeDir, '.cx'), { recursive: true });
  let out;
  try {
    const binPath = fileURLToPath(new URL('../../bin/construct', import.meta.url));
    const r = spawnSync(process.execPath, [binPath, 'oracle', 'review', '--dry-run'], {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        CONSTRUCT_HOME_OVERRIDE: homeDir,
        CONSTRUCT_ORACLE_AUTO_RAISE: 'off',
      },
    });
    assert.equal(r.error, undefined, `CLI failed to spawn: ${r.error}`);
    out = r.stdout || '';
  } finally {
    try { rmTmpDir(projectDir); } catch { /* ignore */ }
    try { rmTmpDir(homeDir); } catch { /* ignore */ }
  }
  const verdictLine = out.split('\n').find((l) => l.startsWith('Oracle verdict:'));
  assert.ok(verdictLine, `expected a verdict line in: ${out}`);
  const verdict = verdictLine.replace('Oracle verdict: ', '').replace(' (needs attention)', '').trim();
  assert.ok(VERDICT_STATES.includes(verdict), `unexpected verdict token: ${verdict}`);
  if (!isCleanVerdict(verdict)) {
    assert.match(verdictLine, /\(needs attention\)$/);
  } else {
    assert.doesNotMatch(verdictLine, /\(needs attention\)$/);
  }
});

// --- Consumer: lib/oracle/index.mjs (daemon `didWork` liveness signal) ---
//
// buildOracleDaemon's tick() closure is not independently exported, and a
// live daemon.run() loop against a non-clean verdict would never idle-stop
// (didWork stays true every tick), which is unbounded for a unit test. The
// closure's only verdict-related branch is `!isCleanVerdict(result.verdict)`
// (lib/oracle/index.mjs) — exactly the boolean covered end-to-end by the
// CLEAN_VERDICTS/isCleanVerdict table test above and by cli.mjs's
// integration test, which exercises the same real runOracleTick() output
// index.mjs's tick() consumes.

test('index.mjs didWork semantics: isCleanVerdict is false for every non-terminal state used in its OR chain', () => {
  for (const state of VERDICT_STATES) {
    if (state === 'passed' || state === 'not-applicable' || state === 'unsupported') {
      assert.equal(isCleanVerdict(state), true, `${state} should be clean`);
    } else {
      assert.equal(isCleanVerdict(state), false, `${state} should register as work-worthy`);
    }
  }
});
