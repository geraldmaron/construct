/**
 * tests/functional/docling-shared-venv.functional.test.mjs — one machine, one docling venv.
 *
 * construct-rf26.16 acceptance: two different projects on one machine resolve
 * to the identical docling venv path and share exactly one provisioned
 * instance — not one venv per project. Pins CX_HOME_OVERRIDE to a single
 * fake machine home, then drives resolution from two isolated project
 * directories (distinct git remotes, so lib/state-root.mjs's per-project
 * `deriveProjectKey` genuinely differs between them) to prove the docling
 * venv path does not follow that per-project key the way per-project state
 * (traces, the vector index) still correctly does.
 *
 * DOCLING_PIN is duplicated here rather than imported (uv-bootstrap.mjs does
 * not export it) — the same convention tests/functional/mcp-ingest-resilience
 * .functional.test.mjs and tests/functional/local-model-doctor.functional.test.mjs
 * already use, so provisioning stays on the cached-hit path (no uv install,
 * no network) instead of attempting a real re-provision.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { doclingVenvPath } from '../../lib/ingest-tooling.mjs';
import { resolveStateRoot } from '../../lib/state-root.mjs';
import { ensureDoclingVenv, defaultRuntimeDir } from '../../lib/runtime/uv-bootstrap.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const DOCLING_PIN = '2.45.0';

function makeGitProject(remoteUrl) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docling-shared-venv-project-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: root });
  return root;
}

function seedFakeVenv(runtimeDir) {
  const venvBin = path.join(runtimeDir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
  fs.mkdirSync(venvBin, { recursive: true });
  const pythonBin = path.join(venvBin, process.platform === 'win32' ? 'python.exe' : 'python');
  fs.writeFileSync(pythonBin, '');
  fs.writeFileSync(
    path.join(runtimeDir, '.install-marker.json'),
    JSON.stringify({ doclingVersion: DOCLING_PIN, pythonBin, installedAt: new Date().toISOString() }),
  );
  return pythonBin;
}

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(prev);
  }
}

test('two isolated projects on one machine resolve to the identical docling venv path', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-docling-shared-home-'));
  const prevHome = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = home;
  const projectA = makeGitProject('git@example.test:org/project-a.git');
  const projectB = makeGitProject('git@example.test:org/project-b.git');
  try {
    // Per-project state (traces, the vector index) still genuinely differs,
    // confirming the two projects are not accidentally the same fixture.
    assert.notEqual(resolveStateRoot(projectA, { ensureDir: false }), resolveStateRoot(projectB, { ensureDir: false }));

    const venvPathFromA = withCwd(projectA, () => doclingVenvPath());
    const venvPathFromB = withCwd(projectB, () => doclingVenvPath());
    assert.equal(venvPathFromA, venvPathFromB, 'docling venv path must not vary by project cwd');
    assert.ok(!venvPathFromA.includes('projects'), 'shared venv path must not nest under a per-project key');
  } finally {
    rmTmpDir(projectA);
    rmTmpDir(projectB);
    rmTmpDir(home);
    if (prevHome === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prevHome;
  }
});

test('provisioning from one project is reused, unprovisioned, by a second project on the same machine', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-docling-shared-home-'));
  const prevHome = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = home;
  const projectA = makeGitProject('git@example.test:org/project-a.git');
  const projectB = makeGitProject('git@example.test:org/project-b.git');
  try {
    const runtimeDir = defaultRuntimeDir();
    const seededPythonBin = seedFakeVenv(runtimeDir);

    const fromA = await withCwd(projectA, () => ensureDoclingVenv());
    assert.equal(fromA.fresh, false, 'project A must hit the already-provisioned fast path, not re-provision');
    assert.equal(fromA.pythonBin, seededPythonBin);

    const fromB = await withCwd(projectB, () => ensureDoclingVenv());
    assert.equal(fromB.fresh, false, 'project B must reuse the same provisioned venv, not re-provision its own');
    assert.equal(fromB.pythonBin, fromA.pythonBin);
    assert.equal(fromB.venvDir, fromA.venvDir);
  } finally {
    rmTmpDir(projectA);
    rmTmpDir(projectB);
    rmTmpDir(home);
    if (prevHome === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prevHome;
  }
});
