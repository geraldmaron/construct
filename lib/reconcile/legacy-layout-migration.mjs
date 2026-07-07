/**
 * lib/reconcile/legacy-layout-migration.mjs — migrate a pre-ADR-0069 two-directory
 * project footprint into the consolidated single `.construct/` layout.
 *
 * Before ADR-0069 a host project split Construct state across `.cx/` (config +
 * runtime markers) and `.construct/` (launcher only). The consolidation moves
 * everything under one `.construct/`, with the launcher demoted to
 * `.construct/launcher/`. A project initialized by an older Construct therefore
 * carries a legacy layout: a `.cx/` tree, and/or launcher files (`run.mjs`,
 * `version`, `bootstrap.*`, `cache/`) at `.construct/` top level instead of
 * `.construct/launcher/`.
 *
 * detect() reports either condition. apply() folds `.cx/` into `.construct/`
 * (never clobbering newer `.construct/` state) and relocates the top-level
 * launcher files into `.construct/launcher/`. Regenerating the hook commands in
 * `.claude/settings.json` to point at `.construct/launcher/run.mjs` is left to
 * `construct sync`, which the summary names.
 *
 * Safety: `ask` — apply() moves files and, on a self-hosting checkout, relocates
 * the very launcher a running session's hooks invoke. It must never run from the
 * silent auto-sync path; only `construct sync --reconcile=legacy-layout-migration`
 * applies it, and only in a session that is not itself served by the launcher
 * being moved. detect() reads only; apply() is idempotent — a migrated project
 * leaves no `.cx/` and no top-level launcher file for the next detect().
 */

import fs from 'node:fs';
import path from 'node:path';
import { launcherDir } from '../config-dir.mjs';

const LEGACY_CONFIG_DIR = '.cx';
const NEW_CONFIG_DIR = '.construct';
const LAUNCHER_FILES = ['run.mjs', 'version', 'bootstrap.sh', 'bootstrap.ps1', 'cache', 'plugins.json'];

function paths(dir = process.cwd()) {
  return {
    dir,
    legacyConfig: path.join(dir, LEGACY_CONFIG_DIR),
    newConfig: path.join(dir, NEW_CONFIG_DIR),
    launcher: launcherDir(dir),
  };
}

// A top-level launcher lives at `.construct/<file>` rather than
// `.construct/launcher/<file>`. `run.mjs` is the definitive marker: a
// consolidated project never has one at `.construct/` top level.

function topLevelLauncherFiles(newConfig, launcher) {
  return LAUNCHER_FILES.filter((name) => {
    const top = path.join(newConfig, name);
    return path.resolve(top) !== path.resolve(path.join(launcher, name)) && fs.existsSync(top);
  });
}

function hasContent(dir) {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

async function detect() {
  const { legacyConfig, newConfig, launcher } = paths();
  const legacyConfigPresent = hasContent(legacyConfig);
  const strays = topLevelLauncherFiles(newConfig, launcher);
  if (!legacyConfigPresent && strays.length === 0) {
    return { needsRepair: false, summary: 'Project already uses the consolidated .construct/ layout.' };
  }

  const parts = [];
  if (legacyConfigPresent) parts.push('a legacy .cx/ config directory');
  if (strays.length) parts.push(`launcher files at .construct/ top level (${strays.join(', ')})`);
  return {
    needsRepair: true,
    summary: `Pre-ADR-0069 layout: ${parts.join(' and ')} — fold into .construct/ (launcher at .construct/launcher/), then run \`construct sync\`.`,
    details: { legacyConfig: legacyConfigPresent, strayLauncherFiles: strays },
  };
}

// Move `src` under `destDir`, merging directories and never overwriting an
// existing destination entry (newer .construct/ state wins over legacy .cx/).

function moveInto(src, destDir, { overwrite = false } = {}) {
  const dest = path.join(destDir, path.basename(src));
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      moveInto(path.join(src, entry), dest, { overwrite });
    }
    fs.rmSync(src, { recursive: true, force: true });
    return;
  }
  if (fs.existsSync(dest) && !overwrite) {
    fs.rmSync(src, { force: true });
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(src, dest);
}

async function apply() {
  const { legacyConfig, newConfig, launcher } = paths();

  // Relocate the launcher first so folding .cx/ can never collide with a
  // stray top-level launcher file being moved in the same pass.

  const strays = topLevelLauncherFiles(newConfig, launcher);
  if (strays.length) {
    fs.mkdirSync(launcher, { recursive: true });
    for (const name of strays) {
      moveInto(path.join(newConfig, name), launcher, { overwrite: true });
    }
  }

  let foldedConfig = false;
  if (hasContent(legacyConfig)) {
    fs.mkdirSync(newConfig, { recursive: true });
    for (const entry of fs.readdirSync(legacyConfig)) {
      moveInto(path.join(legacyConfig, entry), newConfig, { overwrite: false });
    }
    fs.rmSync(legacyConfig, { recursive: true, force: true });
    foldedConfig = true;
  }

  const did = [];
  if (foldedConfig) did.push('folded .cx/ into .construct/');
  if (strays.length) did.push(`moved launcher files (${strays.join(', ')}) into .construct/launcher/`);
  if (!did.length) return { summary: 'Nothing to migrate.' };

  return {
    summary: `${did.join('; ')}. Run \`construct sync\` to repoint hook commands at .construct/launcher/run.mjs. If .cx/ was committed, run: git rm -r --cached .cx`,
  };
}

export default {
  id: 'legacy-layout-migration',
  description: 'Fold a pre-ADR-0069 .cx/ + top-level launcher into the consolidated .construct/ layout.',
  safety: 'ask',
  detect,
  apply,
};
