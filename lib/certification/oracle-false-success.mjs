/**
 * lib/certification/oracle-false-success.mjs — Oracle false-success certification corpus.
 *
 * Hermetic scenarios exercise real Oracle invariant and synthesis paths against
 * fixture-only inputs. Each scenario asserts Oracle does not return a clean verdict
 * when a known false-success condition is present.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { evaluateBead } from '../oracle/invariants/closed-bead-sha-reachable.mjs';
import { check as checkClosedParentOpenChildren } from '../oracle/invariants/closed-parent-has-open-children.mjs';
import { synthesizeVerdict } from '../oracle/synthesize.mjs';

export const ORACLE_FALSE_SUCCESS_SCENARIO_IDS = Object.freeze([
  'unreachable-sha-close',
  'closed-parent-open-children',
  'partial-graph-as-clean',
  'ignored-impact-context',
]);

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function git(cwd, args) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: cwd,
      USERPROFILE: cwd,
      GIT_CONFIG_GLOBAL: path.join(cwd, '.gitconfig-none'),
    },
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function makeUnreachableShaRepo({ workspaceRoot = findConstructRoot() } = {}) {
  const tmpRoot = path.join(workspaceRoot, 'tests', 'fixtures', 'certification', 'oracle-git-workspace');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const cwd = fs.mkdtempSync(path.join(tmpRoot, 'oracle-cert-sha-'));
  git(cwd, ['init', '-q', '-b', 'main', '--template=']);
  git(cwd, ['config', 'user.email', 'cert@example.com']);
  git(cwd, ['config', 'user.name', 'Cert']);
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'a\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'base']);
  const baseSha = git(cwd, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(cwd, 'b.txt'), 'b\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'main-tip']);
  git(cwd, ['checkout', '-q', '-b', 'feature', baseSha]);
  fs.writeFileSync(path.join(cwd, 'c.txt'), 'c\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'unmerged-work']);
  const featureSha = git(cwd, ['rev-parse', 'HEAD']);
  git(cwd, ['checkout', '-q', 'main']);
  return { cwd, featureSha, cleanup: () => fs.rmSync(cwd, { recursive: true, force: true }) };
}

function oracleVerdictIsClean(verdict) {
  return verdict === 'healthy' || verdict === 'passed' || verdict === 'pass';
}

function runUnreachableShaClose(fixture, { rootDir = findConstructRoot() } = {}) {
  const repo = makeUnreachableShaRepo({ workspaceRoot: rootDir });
  try {
    const bead = {
      id: fixture.beadId ?? 'fixture-bead-unreachable-sha',
      close_reason: fixture.closeReason.replace('{{SHA}}', repo.featureSha),
    };
    const result = evaluateBead(bead, { cwd: repo.cwd, mainRef: 'main' });
    const caught = result.status === 'failed' && result.violation === true;
    return {
      scenarioId: 'unreachable-sha-close',
      pass: caught,
      oracleVerdict: result.status,
      detail: caught ? null : `expected failed violation, got ${result.status}: ${result.detail}`,
    };
  } finally {
    repo.cleanup();
  }
}

function runClosedParentOpenChildren(fixture) {
  const closedBeads = fixture.closedBeads ?? [];
  const openBeads = fixture.openBeads ?? [];
  return checkClosedParentOpenChildren({
    listClosedBeads: async () => closedBeads,
    listOpenBeads: async () => openBeads,
  }).then((result) => {
    const caught = result.status === 'failed' && (result.violations?.length ?? 0) > 0;
    return {
      scenarioId: 'closed-parent-open-children',
      pass: caught,
      oracleVerdict: result.status,
      detail: caught ? null : `expected failed with violations, got ${result.status}`,
    };
  });
}

function minimalReadModel(overrides = {}) {
  return {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, workerProfiles: {} },
    alignmentCensus: {
      present: true,
      stale: false,
      generatedAt: new Date().toISOString(),
      audit: { findingsCount: 0, regressions: [] },
      skills: { trueOrphanCount: 0 },
    },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    projectDir: '/tmp',
    dependencyGraph: { present: false },
    ...overrides,
  };
}

function runPartialGraphAsClean(fixture) {
  const readModel = minimalReadModel({
    projectDir: fixture.projectDir ?? '/tmp',
    dependencyGraph: {
      present: true,
      partial: true,
      partialReasons: fixture.partialReasons ?? ['certification fixture: partial graph seed'],
      stale: false,
      coverage: {
        capabilitiesWithoutTest: [],
        capabilitiesWithoutImpl: [],
        workflowsUncovered: [],
        orphanFileCount: 0,
      },
      untested: [],
    },
  });
  const { verdict, gaps } = synthesizeVerdict(readModel);
  const caught = !oracleVerdictIsClean(verdict) && gaps.some((g) => g.id === 'graph-partial');
  return {
    scenarioId: 'partial-graph-as-clean',
    pass: caught,
    oracleVerdict: verdict,
    detail: caught ? null : `expected non-healthy with graph-partial gap, got verdict=${verdict}`,
  };
}

function runIgnoredImpactContext(fixture) {
  const readModel = minimalReadModel({
    projectDir: fixture.projectDir ?? '/tmp',
    changeReviewContext: fixture.changeReviewContext,
    dependencyGraph: fixture.dependencyGraph,
  });
  const { verdict, gaps, context } = synthesizeVerdict(readModel);
  const hasContext = Boolean(context?.changeIntent?.intents?.length);
  const hasImpactGap = gaps.some((g) => g.id === 'impact-untested');
  const caught = hasContext && hasImpactGap && !oracleVerdictIsClean(verdict);
  return {
    scenarioId: 'ignored-impact-context',
    pass: caught,
    oracleVerdict: verdict,
    detail: caught
      ? null
      : `expected impact context consumed with impact-untested gap (hasContext=${hasContext}, hasImpactGap=${hasImpactGap}, verdict=${verdict})`,
  };
}

/**
 * @param {string} scenarioId
 * @param {object} [fixture]
 * @param {{ synthesizeVerdictImpl?: Function }} [opts]
 */
export async function runOracleFalseSuccessScenario(scenarioId, fixture = {}, { rootDir = findConstructRoot() } = {}) {
  switch (scenarioId) {
    case 'unreachable-sha-close':
      return runUnreachableShaClose(fixture, { rootDir });
    case 'closed-parent-open-children':
      return runClosedParentOpenChildren(fixture);
    case 'partial-graph-as-clean':
      return runPartialGraphAsClean(fixture);
    case 'ignored-impact-context':
      return runIgnoredImpactContext(fixture);
    default:
      return { scenarioId, pass: false, oracleVerdict: null, detail: `unknown oracle false-success scenario: ${scenarioId}` };
  }
}

export function loadOracleFalseSuccessFixture(relPath, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const absolute = path.join(root, relPath);
  if (!fs.existsSync(absolute)) throw new Error(`oracle false-success fixture missing: ${relPath}`);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

/**
 * @param {object} opts
 * @param {string} opts.scenarioId
 * @param {string} [opts.fixturePath]
 * @param {string} [opts.rootDir]
 * @param {{ synthesizeVerdictImpl?: Function }} [opts]
 */
export async function validateOracleFalseSuccessScenario({
  scenarioId,
  fixturePath = null,
  rootDir = process.cwd(),
  forceClean = false,
  ...opts
} = {}) {
  if (!ORACLE_FALSE_SUCCESS_SCENARIO_IDS.includes(scenarioId)) {
    return { pass: false, detail: `unknown scenario: ${scenarioId}`, scenarioId, oracleVerdict: null };
  }
  if (forceClean) {
    return {
      scenarioId,
      pass: false,
      oracleVerdict: 'healthy',
      detail: 'simulated Oracle clean verdict on false-success fixture',
      simulatedRegression: true,
    };
  }
  const fixture = fixturePath ? loadOracleFalseSuccessFixture(fixturePath, { rootDir }) : {};
  const result = await runOracleFalseSuccessScenario(scenarioId, fixture, { rootDir });
  return result;
}

/**
 * Runs every Oracle false-success certification scenario for the release gate.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @param {string} [opts.simulateRegressionOn] — mutation-test hook: force one scenario to pass clean
 */
export async function evaluateOracleFalseSuccessGate({ rootDir = process.cwd(), simulateRegressionOn = null } = {}) {
  const root = findConstructRoot(rootDir);
  const catalogPath = path.join(root, 'tests', 'certification', 'scenarios', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const scenarios = (catalog.scenarios ?? []).filter((entry) => entry.id?.startsWith('oracle.false-success.'));
  const errors = [];
  const checks = [];

  for (const scenario of scenarios) {
    const scenarioKey = scenario.gates?.[0]?.scenario ?? scenario.id.replace(/^oracle\.false-success\./, '');
    const result = await validateOracleFalseSuccessScenario({
      scenarioId: scenarioKey,
      fixturePath: scenario.fixture?.path ?? null,
      rootDir: root,
      forceClean: simulateRegressionOn === scenarioKey,
    });
    checks.push({
      kind: 'oracle-false-success',
      scenarioId: scenario.id,
      pass: result.pass === true,
      oracleVerdict: result.oracleVerdict ?? null,
    });
    if (!result.pass) {
      const suffix = result.simulatedRegression ? ' (simulated Oracle regression)' : '';
      errors.push(`oracle false-success scenario ${scenario.id} regressed (${result.detail ?? 'Oracle returned clean on false-success fixture'})${suffix}`);
    }
  }

  return { pass: errors.length === 0, errors, checks, scenarioCount: scenarios.length };
}
