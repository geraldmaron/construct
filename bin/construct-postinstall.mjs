#!/usr/bin/env node
/**
 * bin/construct-postinstall.mjs — npm postinstall hook for consumer projects.
 *
 * When a downstream project pins `@geraldmaron/construct` as a (dev)Dependency
 * and runs `npm install`, npm fetches Construct into the project's
 * `node_modules/` and then runs this script. Its job: regenerate the project's
 * `.claude/agents/` and `.claude/settings.json` from the bundled registry so
 * the project clone is fully runnable without a manual `construct setup`.
 *
 * The script is a no-op in two cases:
 *
 *   1. The install is happening inside the Construct repo itself
 *      (i.e. someone is doing `npm install` from a checkout to develop on
 *      Construct). We detect this by comparing the package's location to
 *      `INIT_CWD` — if Construct is being installed *into itself*, we skip.
 *
 *   2. CONSTRUCT_SKIP_POSTINSTALL=1 is set. Useful for CI or for environments
 *      where the consumer has its own setup flow.
 *
 * Two effects per install:
 *
 *   1. Materialise `.construct/{version,bootstrap.sh,bootstrap.ps1,run.mjs}`
 *      from `templates/distribution/`. The `run.mjs` launcher is the new
 *      target for hook commands in `.claude/settings.json` so hooks resolve
 *      through the project's own pinned Construct rather than a global
 *      `$HOME/.construct/...` path. The bootstrap shims let peers without
 *      Node ecosystems still reach Construct via Docker or a downloaded
 *      single-file binary.
 *
 *   2. Sync `.claude/agents/`, `.claude/settings.json`, and slash commands
 *      from the bundled registry via `sync-agents.mjs --project`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readFileSync, copyFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const SYNC_SCRIPT = path.join(PKG_ROOT, 'scripts', 'sync-agents.mjs');
const PKG_VERSION = (() => {
  try { return JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version || ''; }
  catch { return ''; }
})();
const TEMPLATE_DIR = path.join(PKG_ROOT, 'templates', 'distribution');

const log = (msg) => process.stdout.write(`[construct-postinstall] ${msg}\n`);

if (process.env.CONSTRUCT_SKIP_POSTINSTALL === '1') {
  log('skipping (CONSTRUCT_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

const initCwd = process.env.INIT_CWD || process.cwd();

if (!existsSync(SYNC_SCRIPT)) {
  log(`sync-agents.mjs not found at ${SYNC_SCRIPT}; skipping`);
  process.exit(0);
}

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

// Skip when the install target has no project.json hint that it actually wants
// Construct (e.g. monorepo nested installs that reach the postinstall but
// shouldn't auto-sync). Heuristic: a consumer project must have its own
// package.json at INIT_CWD.
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

// Stage the project-local launcher + bootstrap shims so hook commands and
// non-Node peers can still reach Construct.
function ensureProjectLauncher() {
  const dotConstruct = path.join(initCwd, '.construct');
  mkdirSync(dotConstruct, { recursive: true });
  mkdirSync(path.join(dotConstruct, 'cache', 'bin'), { recursive: true });

  const versionPath = path.join(dotConstruct, 'version');
  if (!existsSync(versionPath) && PKG_VERSION) {
    writeFileSync(versionPath, PKG_VERSION + '\n');
  }

  const copies = [
    ['run.mjs',       0o644],
    ['bootstrap.sh',  0o755],
    ['bootstrap.ps1', 0o644],
  ];
  for (const [name, mode] of copies) {
    const src = path.join(TEMPLATE_DIR, name);
    const dst = path.join(dotConstruct, name);
    if (!existsSync(src)) continue;
    copyFileSync(src, dst);
    try { chmodSync(dst, mode); } catch { /* best effort */ }
  }
}

try {
  ensureProjectLauncher();
  log(`staged .construct/ launcher in ${initCwd}`);
} catch (err) {
  log(`launcher staging failed: ${err.message}`);
}

log(`syncing project adapters into ${initCwd}/.claude/`);
const result = spawnSync(process.execPath, [SYNC_SCRIPT, '--project'], {
  cwd: initCwd,
  stdio: 'inherit',
  env: { ...process.env, CONSTRUCT_PROJECT_ROOT: initCwd },
});

if (result.status !== 0) {
  log(`sync failed (exit ${result.status}); leaving project in a clean state`);
  process.exit(0);
}
