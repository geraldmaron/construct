/**
 * lib/dashboard-demo.mjs — Construct cockpit Playwright demo adapter.
 *
 * Resolves dashboard recording manifests (or legacy script bridge) and delegates
 * to lib/playwright-demo.mjs with dashboard workspace defaults.
 */

import path from 'node:path';
import { loadDemoRecording } from './demo-recording.mjs';
import {
  detectPlaywrightDemo,
  recordPlaywrightDemo,
  collectVideoFiles,
  newestVideo,
  finalizeDemoVideo,
  locateFfmpeg,
  transcodeWebmToMp4,
  resolvePlaywrightPackage,
} from './playwright-demo.mjs';

export {
  collectVideoFiles,
  newestVideo,
  finalizeDemoVideo,
  locateFfmpeg,
  transcodeWebmToMp4,
  resolvePlaywrightPackage,
};

export function dashboardWorkspaceRoot(repoRoot) {
  return path.join(repoRoot, 'apps', 'dashboard');
}

export function detectDashboardDemo({ cwd = process.cwd(), repoRoot } = {}) {
  const root = repoRoot || cwd;
  return detectPlaywrightDemo({ workspace: dashboardWorkspaceRoot(root), repoRoot: root, cwd });
}

export function recordDashboardDemo(name, {
  cwd = process.cwd(),
  repoRoot,
  outputDir,
  outputPath = null,
  format = 'mp4',
  artifactDir = null,
  artifactFile = null,
  env = process.env,
} = {}) {
  const root = repoRoot || cwd;
  const recording = loadDemoRecording(name, { cwd, repoRoot: root });

  if (!recording) {
    const detection = detectDashboardDemo({ cwd, repoRoot: root });
    if (!detection.present) {
      return { ok: false, name, missing: detection.missing, message: detection.message };
    }
    return { ok: false, name, message: `No recording manifest or dashboard demo script for ${name}` };
  }

  const outDir = outputDir || path.join(cwd, '.cx', 'demos', 'dashboard');
  return recordPlaywrightDemo(recording, {
    cwd,
    repoRoot: root,
    outputDir: outDir,
    outputPath,
    format,
    artifactDir,
    artifactFile,
    env,
  });
}
