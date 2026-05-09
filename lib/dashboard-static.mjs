/**
 * lib/dashboard-static.mjs — build and sync the dashboard static bundle.
 *
 * Keeps `dashboard/dist/` and `lib/server/static/` aligned so the HTTP server
 * serves the current dashboard build from repo-owned assets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function walkFiles(rootDir, currentDir = rootDir) {
  if (!fs.existsSync(currentDir)) return [];
  const entries = [];
  for (const name of fs.readdirSync(currentDir)) {
    const fullPath = path.join(currentDir, name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...walkFiles(rootDir, fullPath));
    } else {
      entries.push(path.relative(rootDir, fullPath));
    }
  }
  return entries.sort();
}

function readBufferIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function compareTrees(sourceDir, targetDir) {
  const sourceFiles = walkFiles(sourceDir);
  const targetFiles = walkFiles(targetDir);
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  const copied = [];
  const removed = [];

  for (const relPath of sourceFiles) {
    const source = readBufferIfExists(path.join(sourceDir, relPath));
    const target = readBufferIfExists(path.join(targetDir, relPath));
    if (!target || !source.equals(target)) copied.push(relPath);
  }

  for (const relPath of targetFiles) {
    if (!sourceSet.has(relPath)) removed.push(relPath);
  }

  return {
    copied,
    removed,
    sourceFiles,
    targetFiles,
    changed: copied.length > 0 || removed.length > 0,
    inSync: copied.length === 0 && removed.length === 0,
    sourceExists: fs.existsSync(sourceDir),
  };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function removeEmptyDirs(dirPath, stopAt) {
  let current = dirPath;
  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!fs.existsSync(current)) {
      current = path.dirname(current);
      continue;
    }
    if (fs.readdirSync(current).length > 0) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

export function getDashboardPaths({ rootDir = process.cwd() } = {}) {
  return {
    rootDir,
    dashboardDir: path.join(rootDir, 'dashboard'),
    sourceDir: path.join(rootDir, 'dashboard', 'dist'),
    targetDir: path.join(rootDir, 'lib', 'server', 'static'),
  };
}

export function getDashboardStaticStatus({ rootDir = process.cwd() } = {}) {
  const { sourceDir, targetDir } = getDashboardPaths({ rootDir });
  return compareTrees(sourceDir, targetDir);
}

export function syncDashboardStatic({ rootDir = process.cwd(), check = false } = {}) {
  const { sourceDir, targetDir } = getDashboardPaths({ rootDir });
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Dashboard build output missing: ${sourceDir}`);
  }

  const status = compareTrees(sourceDir, targetDir);
  if (check || !status.changed) return status;

  for (const relPath of status.copied) {
    const sourcePath = path.join(sourceDir, relPath);
    const targetPath = path.join(targetDir, relPath);
    ensureParentDir(targetPath);
    fs.copyFileSync(sourcePath, targetPath);
  }

  for (const relPath of status.removed) {
    const targetPath = path.join(targetDir, relPath);
    fs.rmSync(targetPath, { force: true });
    removeEmptyDirs(path.dirname(targetPath), targetDir);
  }

  return {
    ...status,
    inSync: true,
  };
}

export function buildDashboardStatic({
  rootDir = process.cwd(),
  spawnSyncFn = spawnSync,
} = {}) {
  const { dashboardDir } = getDashboardPaths({ rootDir });
  const result = spawnSyncFn('npm', ['run', 'build'], {
    cwd: dashboardDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'dashboard build failed').trim());
  }
  return result;
}

export async function runDashboardStaticCli(args = [], { rootDir = process.cwd() } = {}) {
  const build = args.includes('--build');
  const check = args.includes('--check');

  if (build) buildDashboardStatic({ rootDir });
  const status = syncDashboardStatic({ rootDir, check });

  if (check) {
    if (status.changed) {
      console.error('Dashboard static assets are out of date. Run `construct dashboard:sync --build`.');
      return 1;
    }
    console.log('Dashboard static assets are up to date.');
    return 0;
  }

  if (status.changed) {
    console.log(`Dashboard static synced: ${status.copied.length} updated, ${status.removed.length} removed.`);
  } else {
    console.log('Dashboard static already up to date.');
  }
  return 0;
}
