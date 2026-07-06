/**
 * tests/functional/ingest-tooling.functional.test.mjs — ingest pipeline detect contract.
 *
 * Exercises detectNodeNativeDeps/detectIngestPipeline against isolated mkdtempSync
 * fixture trees, not the live checked-out repo, so results are pinned to fixture
 * markers instead of whatever happens to be installed in this working copy.
 *
 * The docling venv detection resolves through the machine-scoped state root
 * (ADR-0066: lib/state-root.mjs, `doclingVenvPath` in lib/ingest-tooling.mjs), not
 * a project-relative `.cx/runtime/docling`, so CX_HOME_OVERRIDE is pinned for the
 * whole file to keep the fixture venv off the real developer machine's $HOME.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectIngestPipeline, detectNodeNativeDeps, doclingVenvPath } from '../../lib/ingest-tooling.mjs';

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ingest-tooling-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function makeFixtureRepo({ unpdf = false, mammoth = false, doclingVenv = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-tooling-'));
  if (unpdf) fs.mkdirSync(path.join(root, 'node_modules', 'unpdf'), { recursive: true });
  if (mammoth) fs.mkdirSync(path.join(root, 'node_modules', 'mammoth'), { recursive: true });
  if (doclingVenv) {
    const venvBin = path.join(doclingVenvPath(root), process.platform === 'win32' ? 'Scripts' : 'bin');
    fs.mkdirSync(venvBin, { recursive: true });
    fs.writeFileSync(path.join(venvBin, process.platform === 'win32' ? 'python.exe' : 'python'), '');
  }
  return root;
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
    fs.rmSync(root, { recursive: true, force: true });
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
    fs.rmSync(root, { recursive: true, force: true });
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
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detectIngestPipeline reports high-fidelity ready when the fixture has a provisioned docling venv', () => {
  const root = makeFixtureRepo({ doclingVenv: true });
  try {
    const result = detectIngestPipeline({ cwd: root, repoRoot: root, env: { DOCLING_SERVE_URL: '' } });
    assert.equal(result.ok, true);
    assert.equal(result.steps.docling.present, true);
    assert.equal(result.steps.nodeNative.present, false);
    assert.equal(result.present, true);
    assert.equal(result.message, 'Ingest: high-fidelity docling ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detectIngestPipeline reports fast tier ready when only node-native deps are present', () => {
  const root = makeFixtureRepo({ unpdf: true, mammoth: true });
  try {
    const result = detectIngestPipeline({ cwd: root, repoRoot: root, env: { DOCLING_SERVE_URL: '' } });
    assert.equal(result.steps.docling.present, false);
    assert.equal(result.steps.nodeNative.present, true);
    assert.equal(result.present, true);
    assert.equal(result.message, 'Ingest: fast tier ready (unpdf/mammoth); high-fidelity provisions on first use');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detectIngestPipeline reports degraded when the fixture has neither docling nor node-native deps', () => {
  const root = makeFixtureRepo();
  try {
    const result = detectIngestPipeline({ cwd: root, repoRoot: root, env: { DOCLING_SERVE_URL: '' } });
    assert.equal(result.steps.docling.present, false);
    assert.equal(result.steps.nodeNative.present, false);
    assert.equal(result.present, false);
    assert.equal(result.message, 'Ingest degraded — install optional deps or run construct install --with-docling');
    assert.equal(typeof result.steps.whisper.present, 'boolean');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detectIngestPipeline reflects docling-remote config from the fixture env', () => {
  const root = makeFixtureRepo();
  try {
    const result = detectIngestPipeline({ cwd: root, repoRoot: root, env: { DOCLING_SERVE_URL: 'https://docling.example.test/' } });
    assert.equal(result.steps.doclingRemote.present, true);
    assert.equal(result.steps.doclingRemote.url, 'https://docling.example.test');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
