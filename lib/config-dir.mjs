/**
 * lib/config-dir.mjs — single source of truth for the names and paths of the
 * project-local Construct directory.
 *
 * Two project-local concerns live under a Construct project root: the config
 * layer (context, workflow, custom org/, template overrides, small runtime
 * markers — a user may read or edit these) and the launcher (run.mjs,
 * bootstrap.*, version, cache/, plugins/ — machine-regenerated plumbing a user
 * never edits). Centralizing both names here makes the physical layout a
 * one-line change in this module rather than an edit across every caller.
 *
 * CONFIG_DIR_NAME and LAUNCHER_REL_PATH define the physical layout. The
 * CONFIG_DIR_NAME is `.construct` and
 * LAUNCHER_REL_PATH is `.construct/launcher`, so the launcher nests under the
 * single config root; consumers that resolve through this module move with it.
 * The machine scope `~/.construct/` is a different root and is NOT
 * resolved here — see lib/state-root.mjs.
 */

import path from 'node:path';

// The config-layer directory basename, relative to the project root. Holds the
// user-facing surface: context.md/json, workflow.json, custom org/, template
// overrides, and the small runtime markers that stay project-local after
// Flipped to `.construct` by the consolidation.

export const CONFIG_DIR_NAME = '.construct';

// The launcher directory path, relative to the project root. Holds
// machine-regenerated plumbing: run.mjs, bootstrap.*, version, stage-state.json,
// cache/, plugins/. Flipped to `.construct/launcher` by the consolidation so it
// nests under the single config root instead of being a second top-level dir.

export const LAUNCHER_REL_PATH = '.construct/launcher';

// The Construct project root marker.

export const PROJECT_MARKERS = [CONFIG_DIR_NAME, '.construct'].filter(
  (m, i, arr) => arr.indexOf(m) === i,
);

/** Absolute path to the project config directory for a given project root. */
export function projectConfigDir(projectRoot) {
  return path.join(projectRoot, CONFIG_DIR_NAME);
}

/** Absolute path to a file/subdir inside the project config directory. */
export function configPath(projectRoot, ...segments) {
  return path.join(projectRoot, CONFIG_DIR_NAME, ...segments);
}

/** Absolute path to the launcher directory for a given project root. */
export function launcherDir(projectRoot) {
  return path.join(projectRoot, LAUNCHER_REL_PATH);
}

/** Absolute path to a file/subdir inside the launcher directory. */
export function launcherPath(projectRoot, ...segments) {
  return path.join(projectRoot, LAUNCHER_REL_PATH, ...segments);
}

// gitignore patterns for the project-local Construct footprint, trailing-slash
// form. During the transition window both the config dir and the legacy
// launcher dir are ignored; after consolidation the launcher path is nested
// under the config dir so a single `.construct/` pattern covers both.

export function ignoredDirPatterns() {
  const config = `${CONFIG_DIR_NAME}/`;
  const launcher = `${LAUNCHER_REL_PATH.split('/')[0]}/`;
  return config === launcher ? [config] : [config, launcher];
}
