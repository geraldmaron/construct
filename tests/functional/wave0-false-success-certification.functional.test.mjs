/**
 * tests/functional/wave0-false-success-certification.functional.test.mjs —
 * combined certification that Wave 0's three false-success fixes
 * (construct-4uxq0.9.12 demo, .9.13 Docling, .9.16 graph build) hold
 * together in one run, not just individually (construct-4uxq0.9.18).
 *
 * Re-runs each dependency bead's own regression suite as a subprocess and
 * additionally exercises all three forced-failure paths in this single
 * process, asserting none reports unconditional success. A failure here
 * means a regression in one of the three dependency beads — reopen that
 * bead rather than patching this file. Scope is limited to the three named
 * false-success surfaces; mermaid/playwright/tracker-integrity fixes are
 * explicitly out of scope (security/supply-chain/data-integrity, not
 * false-success paths) per construct-4uxq0.9.18.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { runDemoGuided } from '../../lib/demo-surface.mjs';
import { spawnSidecar } from '../../lib/document-extract/docling-client.mjs';
import { runGraphCli } from '../../lib/graph/cli.mjs';
import { writeProjectEmbedManifest } from '../../lib/embed/capability-loader.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const DOCLING_FIXTURES = path.join(__dirname, 'fixtures');

const DEPENDENCY_SUITES = [
  'tests/functional/demo.functional.test.mjs',
  'tests/functional/docling-sidecar-fault-handling.functional.test.mjs',
  'tests/functional/graph-build-partial-failures.functional.test.mjs',
];

test('all three Wave 0 false-success dependency suites pass together in one run', () => {
  const result = spawnSync(process.execPath, ['--test', ...DEPENDENCY_SUITES], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(
    result.status,
    0,
    `combined dependency-suite run failed:\n${result.stdout}\n${result.stderr}`,
  );
});

const dirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function captureOutput(fn) {
  const out = [];
  const origOut = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { out.push(chunk); return true; };
  try {
    return { result: fn(), stdout: out.join('') };
  } finally {
    process.stdout.write = origOut;
  }
}

function withHomeOverride(root, fn) {
  const prior = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = root;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prior;
  }
}

test('cross-surface smoke: forced script-only demo, malformed Docling message, and malformed embed manifest all surface honestly in the same session', async (t) => {
  await t.test('demo: script-only fallback carries a status discriminator, not a bare ok:true', async () => {
    const dir = freshDir('w0-cert-demo-');
    const scriptsDir = path.join(dir, '.construct', 'demos', 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'cert-demo.json'), JSON.stringify({
      title: 'Certification Demo',
      tape: 'cert-demo',
      steps: [{ title: 'Step 1', command: 'echo hi' }],
    }), 'utf8');

    const output = { write: () => {}, isTTY: false };
    const result = await runDemoGuided('cert-demo', { cwd: dir, repoRoot: REPO, output });

    assert.equal(result.ok, true, 'the operation itself did not error');
    assert.notEqual(result.status, undefined, 'a script-only result must carry a status discriminator');
    assert.equal(result.status, 'script-only');
    assert.equal(result.artifactPath, undefined, 'no artifact was produced — ok:true alone would be a false success');
  });

  await t.test('docling: a malformed sidecar line surfaces a counted, attributed error, not a generic timeout', async () => {
    const sidecar = await spawnSidecar({
      pythonBin: process.execPath,
      scriptPath: path.join(DOCLING_FIXTURES, 'docling-sidecar-malformed-line-fixture.mjs'),
      requestTimeoutMs: 5_000,
    });
    await assert.rejects(
      sidecar.send('extract', { path: '/tmp/cert-check.pdf' }),
      (err) => {
        assert.ok(err.malformedMessageCount >= 1, 'the malformed line must be counted, not silently dropped');
        return true;
      },
    );
  });

  await t.test('graph build: a malformed embed manifest surfaces a build error, not unconditional success', () => {
    const root = freshDir('w0-cert-graph-root-');
    fs.mkdirSync(path.join(root, 'specialists', 'org'), { recursive: true });
    const project = freshDir('w0-cert-graph-proj-');

    writeProjectEmbedManifest('cert-broken-preset', {
      id: 'cert-broken-preset',
      type: 'embed',
      version: '1.0.0',
      defaultApprovalMode: 'proposal-only',
      embed: {
        specialist: 'cx-operations',
        providerBindings: ['github'],
        framework: 'cx-ops-triage',
        outputContract: 'proposal.v1',
        proposalAuthority: 'propose-only',
        // runtime intentionally omitted — a required embed field.
      },
    }, root);

    const run = withHomeOverride(root, () => captureOutput(
      () => runGraphCli(['build', '--json'], { rootDir: root, projectDir: project }),
    ));
    assert.equal(run.result, 1, 'a hard embed validation error must exit non-zero, not report unconditional success');
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.errors.length > 0, 'the swallowed seeder error must be surfaced, not discarded');
  });
});
