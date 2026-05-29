#!/usr/bin/env node
/**
 * bin/construct-postinstall.mjs — npm postinstall hook for consumer projects.
 *
 * When a downstream project pins `@geraldmaron/construct` as a (dev)Dependency
 * and runs `npm install`, npm fetches Construct into the project's
 * `node_modules/` and then runs this script. Its job: regenerate the project's
 * `.claude/agents/` and `.claude/settings.json` from the bundled registry so
 * the project clone is fully runnable without a manual `construct init`.
 *
 * The script is a no-op in three cases:
 *
 *   1. The install is happening inside the Construct repo itself.
 *   2. CONSTRUCT_SKIP_POSTINSTALL=1 is set.
 *   3. The install target has no package.json (monorepo nested installs).
 *
 * Staging itself lives in `lib/install/stage-project.mjs` so `construct init`
 * can call the same code path for opt-in adoption after a clone.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stageProjectAdapters } from '../lib/install/stage-project.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const PKG_VERSION = (() => {
  try { return JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version || ''; }
  catch { return ''; }
})();

const log = (msg) => process.stdout.write(`[construct-postinstall] ${msg}\n`);

if (process.env.CONSTRUCT_SKIP_POSTINSTALL === '1') {
  log('skipping (CONSTRUCT_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

const initCwd = process.env.INIT_CWD || process.cwd();

// Skip when installing inside the Construct repo itself, but still wire up
// the local commit template so contributors get the right editor scaffolding.
try {
  const pkgRealRoot = statSync(PKG_ROOT).isDirectory() ? PKG_ROOT : null;
  if (pkgRealRoot && pkgRealRoot.startsWith(initCwd) && initCwd === PKG_ROOT) {
    log('install is inside the Construct repo itself; skipping sync');
    if (existsSync(path.join(PKG_ROOT, '.gitmessage')) && existsSync(path.join(PKG_ROOT, '.git'))) {
      const cfg = spawnSync('git', ['config', 'commit.template', '.gitmessage'], {
        cwd: PKG_ROOT,
        stdio: 'ignore',
      });
      if (cfg.status === 0) log('configured git commit.template -> .gitmessage');
    }
    process.exit(0);
  }
} catch { /* fall through */ }

// `npm i -g @geraldmaron/construct` runs the postinstall with
// npm_config_global=true. Wire the `construct` front-door agent into the
// user's home directories so it's reachable from every host (Claude Code,
// Codex, Copilot, OpenCode) immediately after a global install. Specialists
// stay project-only and land when the user runs `construct init` in a repo.

if (process.env.npm_config_global === 'true' || process.env.npm_config_global === true) {
  const syncScript = path.join(PKG_ROOT, 'scripts', 'sync-specialists.mjs');
  if (existsSync(syncScript)) {
    log('global install detected; syncing front-door agent into ~/');
    const result = spawnSync(process.execPath, [syncScript, '--global'], {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      log(`global sync failed (exit ${result.status}); run \`construct sync --global\` manually`);
    }
  }
  process.exit(0);
}

// Project install path: require a package.json at the install target so
// monorepo nested installs don't accidentally trigger staging in the wrong
// directory.

const consumerPkgPath = path.join(initCwd, 'package.json');
if (!existsSync(consumerPkgPath)) {
  log(`no package.json at ${initCwd}; skipping`);
  process.exit(0);
}

let consumerPkg = {};
try { consumerPkg = JSON.parse(readFileSync(consumerPkgPath, 'utf8')); } catch { /* empty */ }
if (consumerPkg.name === '@geraldmaron/construct') {
  log('install target is the Construct package itself; skipping');
  process.exit(0);
}

try {
  stageProjectAdapters({
    projectRoot: initCwd,
    packageRoot: PKG_ROOT,
    pkgVersion: PKG_VERSION,
    log,
  });
} catch (err) {
  log(`staging failed: ${err.message}; leaving project in a clean state`);
  process.exit(0);
}
