/**
 * lib/install/stage-project.mjs — shared staging logic for a consumer project.
 *
 * Same work as `bin/construct-postinstall.mjs` but callable from both the
 * npm postinstall hook and `construct init`. Stages `.construct/{run.mjs,
 * bootstrap.sh, bootstrap.ps1, version}` and runs `sync-specialists.mjs --project`
 * to materialise `.claude/agents/` and `.claude/settings.json` from the
 * bundled registry. Idempotent — re-runs overwrite the launcher files but
 * leave existing `.construct/version` and project state untouched beyond
 * what `sync-specialists.mjs --project` writes itself.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export function stageProjectAdapters({ projectRoot, packageRoot, pkgVersion, log }) {
  if (!projectRoot) throw new Error('stageProjectAdapters: projectRoot is required');
  if (!packageRoot) throw new Error('stageProjectAdapters: packageRoot is required');
  const emit = typeof log === 'function' ? log : () => {};

  const templateDir = path.join(packageRoot, 'templates', 'distribution');
  const syncScript = path.join(packageRoot, 'scripts', 'sync-specialists.mjs');

  ensureProjectLauncher({ projectRoot, templateDir, pkgVersion });
  emit(`staged .construct/ launcher in ${projectRoot}`);

  if (!existsSync(syncScript)) {
    emit(`sync-specialists.mjs not found at ${syncScript}; skipping adapter sync`);
    return { staged: true, synced: false };
  }

  emit(`syncing project adapters into ${projectRoot}/.claude/`);
  const result = spawnSync(process.execPath, [syncScript, '--project'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, CONSTRUCT_PROJECT_ROOT: projectRoot },
  });

  if (result.status !== 0) {
    emit(`sync failed (exit ${result.status}); project left in a clean state`);
    return { staged: true, synced: false };
  }
  return { staged: true, synced: true };
}

function ensureProjectLauncher({ projectRoot, templateDir, pkgVersion }) {
  const dotConstruct = path.join(projectRoot, '.construct');
  mkdirSync(dotConstruct, { recursive: true });
  mkdirSync(path.join(dotConstruct, 'cache', 'bin'), { recursive: true });

  const versionPath = path.join(dotConstruct, 'version');
  if (!existsSync(versionPath) && pkgVersion) {
    writeFileSync(versionPath, pkgVersion + '\n');
  }

  const copies = [
    ['run.mjs',       0o644],
    ['bootstrap.sh',  0o755],
    ['bootstrap.ps1', 0o644],
  ];
  for (const [name, mode] of copies) {
    const src = path.join(templateDir, name);
    const dst = path.join(dotConstruct, name);
    if (!existsSync(src)) continue;
    copyFileSync(src, dst);
    try { chmodSync(dst, mode); } catch { /* mode set is best-effort on Windows */ }
  }
}
