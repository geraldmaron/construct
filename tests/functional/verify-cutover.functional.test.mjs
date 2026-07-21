/**
 * tests/functional/verify-cutover.functional.test.mjs — proves the cutover
 * verifier actually fails.
 *
 * scripts/verify-cutover.mjs is the mechanical acceptance gate for the
 * workspace-control-plane program's final bead. A verifier that cannot fail
 * proves nothing, so every test here plants a real violation of a real
 * criterion in an isolated copy of the tree and asserts the specific bead
 * flips to FAIL while its siblings stay PASS.
 *
 * The tree copy is real (`cp -R` of the scanned directories), the verifier is
 * spawned as the real script, and the verdict is read from its `--json` output
 * and its exit code.
 *
 * One test pins the string-awareness of the source scanner: a glob literal
 * containing `/*` must not blind the scanner to a live reference later in the
 * same file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'verify-cutover.mjs');
const SCANNED_PATHS = ['lib', 'bin', 'specialists', 'registry', 'package.json'];

// Baseline open milestones cleared once cutover criteria match current product.
const BASELINE_OPEN_MILESTONES = new Set();

function openBaselineFailures(report) {
  return report.filter((b) => b.status === 'fail' && BASELINE_OPEN_MILESTONES.has(b.milestone));
}

function makeTreeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cutover-'));
  for (const rel of SCANNED_PATHS) {
    const source = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(dir, rel), { recursive: true });
  }
  return dir;
}

function runVerifier(root, extraArgs = []) {
  const result = spawnSync(process.execPath, [SCRIPT, `--root=${root}`, '--json', ...extraArgs], {
    encoding: 'utf8',
    timeout: 300000,
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = null;
  }
  return { code: result.status, report, stdout: result.stdout, stderr: result.stderr };
}

function beadStatus(report, milestone) {
  const entry = report.find((b) => b.milestone === milestone);
  assert.ok(entry, `no bead reported for milestone ${milestone}`);
  return entry;
}

function criterion(report, milestone, nameFragment) {
  const entry = beadStatus(report, milestone);
  const found = entry.criteria.find((c) => c.name.includes(nameFragment));
  assert.ok(found, `no criterion matching "${nameFragment}" under ${milestone}`);
  return found;
}

test('a clean tree passes every static criterion and exits 0', (t) => {
  const root = makeTreeCopy();
  try {
    const { code, report } = runVerifier(root, ['--static-only']);
    assert.ok(report, 'verifier emitted parseable JSON');
    const failing = report.filter((b) => b.status === 'fail');
    const unexpected = failing.filter((b) => !BASELINE_OPEN_MILESTONES.has(b.milestone));
    assert.deepEqual(unexpected.map((b) => b.milestone), [], 'no unexpected bead fails on a clean tree');
    if (unexpected.length === 0 && openBaselineFailures(report).length > 0) {
      return t.skip(`baseline cutover beads still open: ${[...openBaselineFailures(report).map((b) => b.milestone)].join(', ')}`);
    }
    assert.equal(code, 0, 'clean tree exits 0');
    const executed = report.reduce((sum, b) => sum + b.criteria.filter((c) => c.status === 'pass').length, 0);
    assert.ok(executed >= 40, `expected a substantive criterion count, got ${executed}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restoring the deleted flow-engine port fails M0 and only M0', () => {
  const root = makeTreeCopy();
  try {
    fs.writeFileSync(
      path.join(root, 'lib', 'orchestration', 'delegation-flow.mjs'),
      'export function runDelegationFlow() { return null; }\n',
    );
    const { code, report } = runVerifier(root, ['--static-only']);
    assert.equal(code, 1, 'a planted violation exits non-zero');
    assert.equal(beadStatus(report, 'M0').status, 'fail');
    assert.equal(criterion(report, 'M0', 'dead flow-engine port deleted').status, 'fail');
    const otherFailures = report.filter((b) => b.status === 'fail' && b.milestone !== 'M0' && !BASELINE_OPEN_MILESTONES.has(b.milestone));
    assert.deepEqual(otherFailures.map((b) => b.milestone), [], 'the failure is targeted, not global');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a live Oracle daemon constructor fails M3b', () => {
  const root = makeTreeCopy();
  try {
    fs.writeFileSync(
      path.join(root, 'lib', 'oracle', 'relapse.mjs'),
      'import { runOracleDaemon } from "./daemon-entry.mjs";\nexport const start = () => runOracleDaemon();\n',
    );
    const { code, report } = runVerifier(root, ['--static-only']);
    assert.equal(code, 1);
    assert.equal(criterion(report, 'M3b', 'zero live Oracle daemon constructors').status, 'fail');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('re-registering the removed `matrix` alias fails the E9 CLI audit', () => {
  const root = makeTreeCopy();
  try {
    const binPath = path.join(root, 'bin', 'construct');
    const text = fs.readFileSync(binPath, 'utf8');
    const anchor = "   ['graph', async (args) => {";
    assert.ok(text.includes(anchor), 'graph dispatch anchor present');
    fs.writeFileSync(binPath, text.replace(anchor, `   ['matrix', async (args) => { return args; }],\n${anchor}`));
    const { code, report } = runVerifier(root, ['--static-only']);
    assert.equal(code, 1);
    assert.equal(criterion(report, 'E9', 'deprecated `matrix` alias removed').status, 'fail');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a glob literal does not blind the scanner to a later live reference', () => {
  const root = makeTreeCopy();
  try {
    fs.writeFileSync(
      path.join(root, 'lib', 'writes', 'relapse.mjs'),
      [
        "export const TEST_GLOB = '**/*.test.mjs';",
        "import { recordApproval } from '../roles/approval-surface.mjs';",
        'export const record = recordApproval;',
      ].join('\n'),
    );
    const { code, report } = runVerifier(root, ['--static-only']);
    assert.equal(code, 1, 'the reference after the glob literal is still detected');
    assert.equal(criterion(report, 'M2', 'zero live approval-surface importers').status, 'fail');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a deleted module named only in a comment is not a live reference', () => {
  const root = makeTreeCopy();
  try {
    fs.writeFileSync(
      path.join(root, 'lib', 'writes', 'history-note.mjs'),
      [
        '/**',
        ' * Authority recording replaced lib/roles/approval-surface.mjs and the',
        ' * lib/orchestration/delegation-flow.mjs port.',
        ' */',
        '',
        '// runOracleDaemon is named here as prose, not called.',
        '',
        'export const NOTE = true;',
      ].join('\n'),
    );
    const { code, report } = runVerifier(root, ['--static-only']);
    assert.equal(criterion(report, 'M2', 'zero live approval-surface importers').status, 'pass');
    assert.equal(criterion(report, 'M3b', 'zero live Oracle daemon constructors').status, 'pass');
    if (openBaselineFailures(report).length > 0) {
      assert.notEqual(code, 0, 'baseline open beads may still fail the overall run');
      return;
    }
    assert.equal(code, 0, 'comment-only mentions do not fail the verifier');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an expired deferral fails rather than passing silently', () => {
  const root = makeTreeCopy();
  try {
    fs.mkdirSync(path.join(root, 'registry', 'teams'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'registry', 'teams', 'legacy-group.json'),
      JSON.stringify({ id: 'legacy-group', sources: [] }, null, 2),
    );
    const routing = path.join(root, 'lib', 'orchestration', 'routing-tables.mjs');
    const text = fs.readFileSync(routing, 'utf8');
    fs.writeFileSync(routing, text
      .replace(/export function teamForSpecialist/g, 'function retiredTeamForSpecialist')
      .replace(/export function specialistsInTeam/g, 'function retiredSpecialistsInTeam'));
    for (const rel of ['lib', 'bin']) {
      const target = path.join(root, rel);
      const stack = [target];
      while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) { stack.push(full); continue; }
          if (!/\.(mjs|js|cjs)$/.test(entry.name) && entry.name !== 'construct') continue;
          const body = fs.readFileSync(full, 'utf8');
          if (!/registry\.teams|teamForSpecialist|specialistsInTeam/.test(body)) continue;
          fs.writeFileSync(full, body
            .replace(/registry\.teams/g, 'registry.retiredTeams')
            .replace(/teamForSpecialist/g, 'retiredTeamForSpecialist')
            .replace(/specialistsInTeam/g, 'retiredSpecialistsInTeam'));
        }
      }
    }
    const { code, report } = runVerifier(root, ['--static-only']);
    assert.equal(code, 1, 'a deferral with no surviving consumer must fail');
    const deferred = criterion(report, 'M4', 'teams/groups retirement deferral');
    assert.equal(deferred.status, 'fail');
    assert.match(deferred.detail, /deferral has expired|no live consumer remains/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the real repository passes every criterion, cli checks included', (t) => {
  const { code, report } = runVerifier(REPO_ROOT);
  assert.ok(report, 'verifier emitted parseable JSON for the real tree');
  const skipped = report.flatMap((b) => b.criteria.filter((c) => c.status === 'skipped'));
  assert.deepEqual(skipped, [], 'no criterion is skipped on the real run');
  const failing = report.filter((b) => b.status === 'fail');
  const openBaseline = openBaselineFailures(report);
  if (openBaseline.length > 0) {
    return t.skip(`baseline cutover beads still open on the real tree: ${openBaseline.map((b) => b.milestone).join(', ')}`);
  }
  assert.deepEqual(
    failing.map((b) => `${b.milestone}: ${b.criteria.filter((c) => c.status === 'fail').map((c) => c.name).join(', ')}`),
    [],
    'every bead passes on the real tree',
  );
  assert.equal(code, 0);
});
