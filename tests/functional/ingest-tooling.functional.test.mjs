/**
 * tests/functional/ingest-tooling.functional.test.mjs — ingest pipeline detect contract.
 *
 * Exercises detectNodeNativeDeps/detectIngestPipeline against isolated mkdtempSync
 * fixture trees, not the live checked-out repo, so results are pinned to fixture
 * markers instead of whatever happens to be installed in this working copy.
 *
 * The docling venv detection resolves through the machine-shared runtime root
 * (ADR-0066/construct-rf26.16: `resolveSharedRuntimeDir` in lib/state-root.mjs,
 * `doclingVenvPath` in lib/ingest-tooling.mjs), never a project-relative or
 * project-keyed path — `doclingVenvPath()` takes no root/cwd argument at all.
 * Because of that, a fixture "venv" is not scoped by fixture root the way
 * unpdf/mammoth markers are: every test that exercises docling presence gets
 * its own isolated CX_HOME_OVERRIDE rather than sharing one across the file,
 * so provisioning the venv in one test cannot leak into another test's
 * "not provisioned" assertion.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectIngestPipeline, detectNodeNativeDeps, doclingVenvPath } from '../../lib/ingest-tooling.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function withFreshHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ingest-tooling-home-'));
  const prev = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = home;
  try {
    return fn(home);
  } finally {
    if (prev === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prev;
    rmTmpDir(home);
  }
}

function makeFixtureRepo({ unpdf = false, mammoth = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-tooling-'));
  if (unpdf) fs.mkdirSync(path.join(root, 'node_modules', 'unpdf'), { recursive: true });
  if (mammoth) fs.mkdirSync(path.join(root, 'node_modules', 'mammoth'), { recursive: true });
  return root;
}

function provisionFakeDoclingVenv() {
  const venvBin = path.join(doclingVenvPath(), process.platform === 'win32' ? 'Scripts' : 'bin');
  fs.mkdirSync(venvBin, { recursive: true });
  fs.writeFileSync(path.join(venvBin, process.platform === 'win32' ? 'python.exe' : 'python'), '');
}

test('detectNodeNativeDeps reports both deps present from fixture markers', () => {
  const root = makeFixtureRepo({ unpdf: true, mammoth: true });
  try {
    const result = detectNodeNativeDeps({ repoRoot: root });
    assert.equal(result.ok, true);
    assert.equal(result.present, true);
    assert.equal(result.unpdf, true);
    assert.equal(result.mammoth, true);
    assert.equal(result.message, 'Node-native extraction ready (unpdf + mammoth)');
  } finally {
    rmTmpDir(root);
  }
});

test('detectNodeNativeDeps reports the specific missing dep from a partial fixture', () => {
  const root = makeFixtureRepo({ unpdf: true, mammoth: false });
  try {
    const result = detectNodeNativeDeps({ repoRoot: root });
    assert.equal(result.present, false);
    assert.equal(result.unpdf, true);
    assert.equal(result.mammoth, false);
    assert.equal(result.message, 'Missing optional deps: mammoth');
  } finally {
    rmTmpDir(root);
  }
});

test('detectNodeNativeDeps reports both deps missing on an empty fixture', () => {
  const root = makeFixtureRepo();
  try {
    const result = detectNodeNativeDeps({ repoRoot: root });
    assert.equal(result.present, false);
    assert.equal(result.unpdf, false);
    assert.equal(result.mammoth, false);
    assert.equal(result.message, 'Missing optional deps: unpdf, mammoth');
  } finally {
    rmTmpDir(root);
  }
});

test('detectIngestPipeline reports high-fidelity ready when the shared venv is provisioned', () => {
  withFreshHome(() => {
    const root = makeFixtureRepo();
    try {
      provisionFakeDoclingVenv();
      const result = detectIngestPipeline({ repoRoot: root, env: { DOCLING_SERVE_URL: '' } });
      assert.equal(result.ok, true);
      assert.equal(result.steps.docling.present, true);
      assert.equal(result.steps.nodeNative.present, false);
      assert.equal(result.present, true);
      assert.equal(result.message, 'Ingest: high-fidelity docling ready');
    } finally {
      rmTmpDir(root);
    }
  });
});

test('detectIngestPipeline reports fast tier ready when only node-native deps are present', () => {
  withFreshHome(() => {
    const root = makeFixtureRepo({ unpdf: true, mammoth: true });
    try {
      const result = detectIngestPipeline({ repoRoot: root, env: { DOCLING_SERVE_URL: '' } });
      assert.equal(result.steps.docling.present, false);
      assert.equal(result.steps.nodeNative.present, true);
      assert.equal(result.present, true);
      assert.equal(result.message, 'Ingest: fast tier ready (unpdf/mammoth); high-fidelity provisions on first use');
    } finally {
      rmTmpDir(root);
    }
  });
});

test('detectIngestPipeline reports degraded when the fixture has neither docling nor node-native deps', () => {
  withFreshHome(() => {
    const root = makeFixtureRepo();
    try {
      const result = detectIngestPipeline({ repoRoot: root, env: { DOCLING_SERVE_URL: '' } });
      assert.equal(result.steps.docling.present, false);
      assert.equal(result.steps.nodeNative.present, false);
      assert.equal(result.present, false);
      assert.equal(result.message, 'Ingest degraded — install optional deps or run construct install --with-docling');
      assert.equal(typeof result.steps.whisper.present, 'boolean');
    } finally {
      rmTmpDir(root);
    }
  });
});

test('detectIngestPipeline reflects docling-remote config from the fixture env', () => {
  withFreshHome(() => {
    const root = makeFixtureRepo();
    try {
      const result = detectIngestPipeline({ repoRoot: root, env: { DOCLING_SERVE_URL: 'https://docling.example.test/' } });
      assert.equal(result.steps.doclingRemote.present, true);
      assert.equal(result.steps.doclingRemote.url, 'https://docling.example.test');
    } finally {
      rmTmpDir(root);
    }
  });
});
