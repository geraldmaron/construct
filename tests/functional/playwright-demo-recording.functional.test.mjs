/**
 * tests/functional/playwright-demo-recording.functional.test.mjs — Playwright demo recording path.
 *
 * Spawns the real recordPlaywrightDemo pipeline in an isolated tmpdir workspace with
 * a local @playwright/test install in the fixture workspace. Skips when Chromium is unavailable.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  recordPlaywrightDemo,
  readArtifactManifest,
  selectPrimaryVideoArtifact,
} from '../../lib/playwright-demo.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'playwright-demo-workspace');

let sharedBrowsersPath = null;

async function ensurePlaywrightBrowsers() {
  if (sharedBrowsersPath) return sharedBrowsersPath;
  sharedBrowsersPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-browsers-'));
  const bootstrap = spawnSync(process.execPath, [
    path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'),
    'install', 'chromium',
  ], {
    encoding: 'utf8',
    timeout: 180_000,
    env: sterileSpawnEnv({ PLAYWRIGHT_BROWSERS_PATH: sharedBrowsersPath }),
  });
  if (bootstrap.status !== 0) {
    sharedBrowsersPath = null;
    return null;
  }
  return sharedBrowsersPath;
}

async function chromiumAvailable() {
  try {
    const browsersPath = await ensurePlaywrightBrowsers();
    if (!browsersPath) return false;
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
    });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

function prepareWorkspace(dir) {
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const pkgPath = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.devDependencies = { '@playwright/test': '1.61.1' };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 180_000,
    env: sterileSpawnEnv({ HOME: dir }),
  });
  assert.equal(install.status, 0, install.stderr || install.stdout || 'npm install failed');
  return dir;
}

function workspaceEnv(homeDir) {
  return sterileSpawnEnv({ HOME: homeDir, PLAYWRIGHT_BROWSERS_PATH: sharedBrowsersPath });
}

test('recordPlaywrightDemo records via manifest-owned video artifact', async (t) => {
  if (!(await chromiumAvailable())) {
    t.skip('Chromium unavailable (run playwright install chromium to exercise this test)');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-demo-fn-'));
  t.after(() => rmTmpDir(dir));
  prepareWorkspace(dir);

  const outputDir = path.join(dir, 'output');
  const specRel = 'specs/minimal.spec.ts';
  const recording = {
    name: 'minimal',
    engine: 'playwright',
    workspace: '.',
    spec: specRel,
    playwrightConfig: 'playwright.config.mjs',
    skipWebServer: true,
    output: { format: 'webm', path: 'output/minimal.webm' },
  };

  const strayPath = path.join(outputDir, 'stray-newer.webm');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(strayPath, 'stray');
  const future = Date.now() + 60_000;
  fs.utimesSync(strayPath, future / 1000, future / 1000);

  const result = recordPlaywrightDemo(recording, {
    cwd: dir,
    repoRoot: dir,
    env: workspaceEnv(dir),
    format: 'webm',
  });

  assert.equal(result.ok, true, result.message || 'recording failed');
  assert.ok(fs.existsSync(result.outputPath));
  assert.ok(fs.existsSync(result.manifestPath));
  assert.equal(result.artifactPath, selectPrimaryVideoArtifact(readArtifactManifest(result.manifestPath)));
  assert.notEqual(result.artifactPath, strayPath);
  assert.notEqual(path.basename(result.artifactPath), 'stray-newer.webm');
});

test('recordPlaywrightDemo supports screencast recording mode', async (t) => {
  if (!(await chromiumAvailable())) {
    t.skip('Chromium unavailable (run playwright install chromium to exercise this test)');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-demo-sc-'));
  t.after(() => rmTmpDir(dir));
  prepareWorkspace(dir);

  const recording = {
    name: 'screencast',
    engine: 'playwright',
    workspace: '.',
    spec: 'specs/screencast.spec.ts',
    playwrightConfig: 'playwright.config.mjs',
    recordingMode: 'screencast',
    skipWebServer: true,
    output: { format: 'webm', path: 'output/screencast.webm' },
  };

  const result = recordPlaywrightDemo(recording, {
    cwd: dir,
    repoRoot: dir,
    env: workspaceEnv(dir),
    format: 'webm',
  });

  assert.equal(result.ok, true, result.message || 'screencast recording failed');
  assert.equal(result.recordingMode, 'screencast');
  assert.ok(fs.existsSync(result.outputPath));
  const manifest = readArtifactManifest(result.manifestPath);
  assert.ok(manifest.artifacts.some((entry) => entry.mode === 'screencast'));
});
