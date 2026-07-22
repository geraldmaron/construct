/**
 * lib/adapters-sync.mjs — project adapter sync for the Construct tool repo and
 * `npm run adapters`. Detects installed hosts, runs sync-worker-profiles --project,
 * and is invoked from postinstall when developing inside the package itself.
 *
 * Consumer bootstrap (npm postinstall / construct init) uses lean host selection:
 * Claude baseline plus any host already configured in the project — not every
 * editor CLI on PATH (construct-w4hly). Expand with --with-<host>, --all-hosts,
 * or CONSTRUCT_SYNC_HOSTS.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectHostCapabilities } from './host-capabilities.mjs';
import { isConstructPackageRepo } from './host-disposition.mjs';
import { stageProjectAdapters } from './install/stage-project.mjs';
import { HOST_KEYS } from './platforms/capabilities.mjs';
import { isMainModule } from './roots.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(MODULE_DIR, '..');

export const HOST_ID_MAP = {
  'Claude Code': 'claude',
  OpenCode: 'opencode',
  Codex: 'codex',
  'VS Code': 'vscode',
  Cursor: 'cursor',
  Copilot: 'copilot',
};

// Construct-owned project markers (not bare editor dirs). Presence means a prior
// sync already configured that host — lean bootstrap must keep refreshing it so
// a later lean postinstall does not prune adapters as stale.

export const PROJECT_HOST_MARKERS = Object.freeze({
  claude: ['.claude/settings.json', '.claude/agents/construct.md'],
  codex: ['.codex/agents/construct.toml'],
  opencode: ['.opencode/opencode.json'],
  vscode: ['.vscode/mcp.json'],
  cursor: ['.cursor/mcp.json'],
  copilot: ['.github/prompts/construct.prompt.md'],
});

// forceAll must list every key in HOST_ID_MAP. sync-worker-profiles.mjs prunes any
// adapter file not in its --hosts= selection as stale (including committed
// files like .github/agents/construct.agent.md) — a host missing here gets
// its adapter deleted on any contributor machine that doesn't have that host
// installed, even though the file is checked into the repo for everyone.

export function resolveAdapterHosts({ forceAll = false, extra = [] } = {}) {
  if (forceAll) return ['claude', 'opencode', 'codex', 'vscode', 'cursor', 'copilot'];
  const hosts = new Set(extra);
  for (const entry of detectHostCapabilities()) {
    if (entry.availability !== 'installed') continue;
    const id = HOST_ID_MAP[entry.host];
    if (id) hosts.add(id);
  }
  if (hosts.size === 0) hosts.add('claude');
  return [...hosts];
}

/**
 * Lean bootstrap host set for postinstall / init (construct-w4hly).
 * Always includes Claude (baseline; VS Code also reads `.claude/`). Unions
 * explicit extras and hosts that already have Construct project markers.
 * Does not consult PATH — a loaded machine with every editor CLI must not
 * bloat a fresh project.
 *
 * @param {string|null|undefined} projectRoot
 * @param {{ extra?: string[] }} [opts]
 * @returns {string[]}
 */
export function resolveLeanBootstrapHosts(projectRoot, { extra = [] } = {}) {
  const selected = new Set(['claude']);
  for (const host of extra) {
    const key = String(host || '').trim().toLowerCase();
    if (HOST_KEYS.includes(key)) selected.add(key);
  }
  if (projectRoot) {
    for (const [host, markers] of Object.entries(PROJECT_HOST_MARKERS)) {
      for (const rel of markers) {
        if (existsSync(path.join(projectRoot, rel))) {
          selected.add(host);
          break;
        }
      }
    }
  }
  return HOST_KEYS.filter((key) => selected.has(key));
}

/**
 * Host list for consumer npm postinstall. Honors CONSTRUCT_SYNC_HOSTS (=all or
 * comma list) as an explicit opt-in override; otherwise lean bootstrap.
 *
 * @param {string} projectRoot
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {string[]}
 */
export function resolvePostinstallHosts(projectRoot, { env = process.env } = {}) {
  const raw = env.CONSTRUCT_SYNC_HOSTS;
  if (raw != null && String(raw).trim() !== '') {
    if (String(raw).trim().toLowerCase() === 'all') {
      return resolveAdapterHosts({ forceAll: true });
    }
    const wanted = String(raw)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return resolveLeanBootstrapHosts(projectRoot, { extra: wanted });
  }
  return resolveLeanBootstrapHosts(projectRoot);
}

export function syncProjectAdapters({
  projectRoot = process.cwd(),
  packageRoot = PKG_ROOT,
  hosts = null,
  log = () => {},
} = {}) {
  const resolvedHosts = hosts ?? resolveAdapterHosts({ forceAll: isConstructPackageRepo(projectRoot) });
  return stageProjectAdapters({
    projectRoot,
    packageRoot,
    pkgVersion: null,
    log,
    hosts: resolvedHosts,
  });
}

export function runAdaptersScript({ cwd = process.cwd(), hosts = null } = {}) {
  const result = syncProjectAdapters({ projectRoot: cwd, hosts, log: (m) => process.stdout.write(`[adapters] ${m}\n`) });
  return result.synced ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const forceAll = args.has('--all-hosts');
  const hosts = forceAll ? resolveAdapterHosts({ forceAll: true }) : null;
  const code = runAdaptersScript({ cwd: process.cwd(), hosts });
  process.exit(code);
}
