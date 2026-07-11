/**
 * lib/install/stage-project.mjs — shared staging logic for a consumer project.
 *
 * Same work as `bin/construct-postinstall.mjs` but callable from both the
 * npm postinstall hook and `construct init`. Stages `.construct/{run.mjs,
 * bootstrap.sh, bootstrap.ps1, version}` and runs `sync-specialists.mjs --project`
 * to materialise `.claude/agents/` and `.claude/settings.json` from the
 * bundled registry. Re-runs overwrite the launcher files AND `.construct/version`
 * to match the currently-running package — a re-stage is how a consumer upgrade
 * propagates; leaving the old pin in place would make the launcher's pinned-npx
 * resolver (templates/distribution/run.mjs) keep serving the previous version
 * indefinitely even after a newer global install.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, copyFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { launcherDir, launcherPath } from '../config-dir.mjs';

export function stageProjectAdapters({ projectRoot, packageRoot, pkgVersion, log, hosts = null }) {
  if (!projectRoot) throw new Error('stageProjectAdapters: projectRoot is required');
  if (!packageRoot) throw new Error('stageProjectAdapters: packageRoot is required');
  const emit = typeof log === 'function' ? log : () => {};

  const templateDir = path.join(packageRoot, 'templates', 'distribution');
  const syncScript = path.join(packageRoot, 'scripts', 'sync-specialists.mjs');

  ensureProjectLauncher({ projectRoot, templateDir, pkgVersion });
  emit(`staged .construct/ launcher in ${projectRoot}`);

  if (!existsSync(syncScript)) {
    emit(`sync-specialists.mjs not found at ${syncScript}; skipping adapter sync`);
    return finishStage({ projectRoot, pkgVersion, synced: false, reason: 'sync-script-missing' });
  }

  // A `hosts` array restricts which adapter sets sync writes (construct-4xy6);
  // null/empty leaves sync writing every host, preserving the postinstall path.

  const syncArgs = [syncScript, '--project'];
  if (Array.isArray(hosts) && hosts.length > 0) syncArgs.push(`--hosts=${hosts.join(',')}`);

  emit(`syncing project adapters into ${projectRoot}/.claude/`);
  const result = spawnSync(process.execPath, syncArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, CONSTRUCT_PROJECT_ROOT: projectRoot },
  });

  if (result.status !== 0) {
    emit(`sync failed (exit ${result.status}); project left in a clean state`);
    return finishStage({ projectRoot, pkgVersion, synced: false, reason: `sync-exit-${result.status}` });
  }
  return finishStage({ projectRoot, pkgVersion, synced: true, reason: null });
}

const STAGE_STATE_FILE = 'stage-state.json';

// Record the staging outcome under .construct/ so a half-stage (launcher present,
// adapters not synced) is detectable and repairable instead of re-derived from
// filesystem heuristics. The marker write is best-effort — a state-write failure must
// never turn a successful stage into a reported failure.

function finishStage({ projectRoot, pkgVersion, synced, reason }) {
  const dotConstruct = launcherDir(projectRoot);
  try {
    mkdirSync(dotConstruct, { recursive: true });
    const state = { staged: true, synced, reason, pkgVersion: pkgVersion ?? null, ts: new Date().toISOString() };
    writeFileSync(path.join(dotConstruct, STAGE_STATE_FILE), JSON.stringify(state, null, 2) + '\n');
  } catch { /* marker is advisory */ }
  return { staged: true, synced };
}

export function readStageState(projectRoot) {
  try {
    return JSON.parse(readFileSync(launcherPath(projectRoot, STAGE_STATE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

// Re-drive a half-staged project to a synced state. stageProjectAdapters is idempotent,
// so re-running the sync is the repair; an already-synced project is a no-op.

export function repairStagedProject({ projectRoot, packageRoot, pkgVersion, log, hosts = null }) {
  const state = readStageState(projectRoot);
  if (state && state.synced === true) {
    return { staged: true, synced: true, repaired: false };
  }
  const result = stageProjectAdapters({ projectRoot, packageRoot, pkgVersion, log, hosts });
  return { ...result, repaired: result.synced === true };
}

function ensureProjectLauncher({ projectRoot, templateDir, pkgVersion }) {
  const dotConstruct = launcherDir(projectRoot);
  mkdirSync(dotConstruct, { recursive: true });
  mkdirSync(path.join(dotConstruct, 'cache', 'bin'), { recursive: true });

  // The pin must move on every stage, not just the first: a consumer running
  // `construct init`/`sync` with a newer package installed is upgrading, and a
  // stale pin here means the staged launcher keeps npx-resolving the old
  // version indefinitely even though a newer one is right there on PATH.

  const versionPath = path.join(dotConstruct, 'version');
  if (pkgVersion) {
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
