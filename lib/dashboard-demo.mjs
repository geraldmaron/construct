/**
 * lib/dashboard-demo.mjs — Playwright dashboard demo recordings.
 *
 * Spawns the dashboard workspace demo project (webServer + video:on) per
 * Playwright Test docs. Stays out of core npm; @playwright/test lives in
 * apps/dashboard only (ADR-0031 footprint).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function dashboardWorkspaceRoot(repoRoot) {
  return path.join(repoRoot, 'apps', 'dashboard');
}

export function resolvePlaywrightPackage(workspace, repoRoot) {
  const candidates = [
    path.join(workspace, 'node_modules', '@playwright', 'test'),
    path.join(repoRoot, 'node_modules', '@playwright', 'test'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

export function detectDashboardDemo({ cwd = process.cwd(), repoRoot } = {}) {
  const root = repoRoot || cwd;
  const workspace = dashboardWorkspaceRoot(root);
  const pkg = path.join(workspace, 'package.json');
  const configCandidates = ['playwright.config.mjs', 'playwright.config.ts'].map((f) => path.join(workspace, f));
  const config = configCandidates.find((p) => fs.existsSync(p));
  const missing = [];
  if (!fs.existsSync(pkg)) missing.push('apps/dashboard/package.json');
  if (!config) missing.push('apps/dashboard/playwright.config.mjs');
  if (!resolvePlaywrightPackage(workspace, root)) {
    missing.push('@playwright/test (npm install in apps/dashboard)');
  }
  return {
    ok: true,
    present: missing.length === 0,
    workspace,
    missing,
    message: missing.length === 0
      ? 'Dashboard demo tooling ready'
      : `Install dashboard demo deps: ${missing.join('; ')}`,
  };
}

export function recordDashboardDemo(name, {
  cwd = process.cwd(),
  repoRoot,
  outputDir,
  env = process.env,
} = {}) {
  const root = repoRoot || cwd;
  const detection = detectDashboardDemo({ cwd, repoRoot: root });
  if (!detection.present) {
    return { ok: false, name, missing: detection.missing, message: detection.message };
  }

  const outDir = outputDir || path.join(cwd, '.cx', 'demos', 'dashboard');
  fs.mkdirSync(outDir, { recursive: true });

  const spec = `e2e/demo/${name}.spec.ts`;
  const specPath = path.join(detection.workspace, spec);
  if (!fs.existsSync(specPath)) {
    return { ok: false, name, message: `Demo spec not found: ${specPath}` };
  }

  const result = spawnSync('npm', ['run', 'demo:record', '--', name], {
    cwd: detection.workspace,
    encoding: 'utf8',
    env: {
      ...env,
      DEMO_OUTPUT_DIR: outDir,
      CI: env.CI || '',
    },
    timeout: 300_000,
  });

  if (result.status !== 0) {
    return {
      ok: false,
      name,
      message: `Playwright demo failed (exit ${result.status}): ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`,
    };
  }

  const collected = [];
  function walkVideos(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walkVideos(p);
      else if (/\.(webm|mp4)$/.test(ent.name)) collected.push(p);
    }
  }
  walkVideos(path.join(detection.workspace, 'test-results'));
  walkVideos(outDir);

  const copied = [];
  for (const src of collected) {
    const dest = path.join(outDir, path.basename(src));
    try {
      fs.copyFileSync(src, dest);
      copied.push(dest);
    } catch { /* skip */ }
  }

  return {
    ok: true,
    name,
    outputDir: outDir,
    videos: copied.length ? copied.map((p) => path.basename(p)) : collected.map((p) => path.basename(p)),
    message: copied.length
      ? `Recorded dashboard demo to ${outDir}`
      : `Demo completed; check ${path.join(detection.workspace, 'test-results')} for video artifacts`,
  };
}
