/**
 * kernel/cleanup/catalog.ts — detection catalog for traces the predecessor
 * (construct-legacy, "v2") leaves on a project checkout and a user's machine.
 * Ported from construct-legacy's lib/uninstall/uninstall.mjs, ids and category
 * boundaries preserved so the behavior stays recognizable across the rewrite.
 *
 * One change from the source: MCP ids are hardcoded (KNOWN_PROJECT_MCP_IDS,
 * MEMORY_MCP_IDS) instead of read from v2's own registry/catalog files —
 * cleanup must detect and remove v2's traces even after the v2 package itself
 * has already been uninstalled, so it cannot depend on v2's package internals
 * being present.
 *
 * The Docker (postgres container + optional pgvector image) and macOS
 * LaunchAgent items spawn a live external process rather than doing a
 * filesystem check, so they can't lean on the fixture-home approach the rest
 * of the catalog uses. They take their process boundary (`spawn`) and the
 * ambient `platform` as optional CleanupTarget overrides instead, so tests can
 * fake both without touching a real docker/launchctl. v2's CONSTRUCT_PG_CONTAINER
 * pin is intentionally not ported: honoring it would mean reading process.env
 * here, and kernel/paths.ts is meant to stay the only module that does — a
 * pinned custom container name is rare enough to fall back to the manual
 * follow-up path. See construct-506.1.1.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Paths } from '../paths.ts';

export type CleanupScope = 'project' | 'machine';
export type CleanupRisk = 'auto' | 'ask';

export interface CleanupItem {
  readonly id: string;
  readonly scope: CleanupScope;
  readonly risk: CleanupRisk;
  readonly label: string;
  detect(): boolean;
  describe(): string;
  remove(): string;
}

export interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type SpawnFn = (command: string, args: string[]) => SpawnResult;

export interface CleanupTarget {
  readonly cwd: string;
  readonly home: string;
  readonly paths: Paths;
  readonly withImages?: boolean;
  readonly platform?: NodeJS.Platform;
  readonly spawn?: SpawnFn;
}

// Verified 2026-08-03 against construct-legacy's lib/mcp-catalog.json: the
// "core" category holds only context7, and construct-mcp is always added by
// lib/uninstall.mjs's projectManagedMcpIds(). Hardcoded rather than read from
// that file for the reason in the header comment.
const KNOWN_PROJECT_MCP_IDS = ['context7', 'construct-mcp'];

// construct-legacy's MEMORY_MCP_KEYS.
const MEMORY_MCP_IDS = ['memory', 'cass'];

// construct-legacy's LEGACY_PG_CONTAINER (pre-home-namespacing installs) and
// PGVECTOR_IMAGE / PRESSURE_GUARD_LABEL constants.
const LEGACY_PG_CONTAINER = 'construct-postgres';
const PGVECTOR_IMAGE = 'pgvector/pgvector:pg16';
const PRESSURE_GUARD_LABEL = 'dev.construct.pressure-release';

// Mirrors construct-legacy's home-namespace.mjs derivation (sha256 of the
// resolved home, first 8 hex chars) so cleanup finds a v2 install's
// per-home-namespaced container, not just the legacy singular name.
function postgresContainerName(home: string): string {
  const suffix = createHash('sha256').update(home).digest('hex').slice(0, 8);
  return `construct-postgres-${suffix}`;
}

function defaultSpawn(command: string, args: string[]): SpawnResult {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function buildCleanupCatalog(target: CleanupTarget): CleanupItem[] {
  const { cwd, home, paths } = target;
  const withImages = target.withImages ?? false;
  const platform = target.platform ?? process.platform;
  const spawn = target.spawn ?? defaultSpawn;
  const pgContainerName = postgresContainerName(home);
  const launchAgentPlist = path.join(home, 'Library', 'LaunchAgents', `${PRESSURE_GUARD_LABEL}.plist`);

  const dotConstruct = path.join(cwd, '.construct');
  const launcherDir = path.join(dotConstruct, 'launcher');
  const dotClaudeAgents = path.join(cwd, '.claude', 'agents');
  const dotClaudeCommands = path.join(cwd, '.claude', 'commands');
  const dotClaudeSettings = path.join(cwd, '.claude', 'settings.json');
  const dotMcpJson = path.join(cwd, '.mcp.json');
  const projectAgentsMd = path.join(cwd, 'AGENTS.md');
  const projectPlanMd = path.join(cwd, 'plan.md');

  const userConfigDir = paths.configDir;
  const userEmbedCache = path.join(paths.cacheDir, 'embeddings');
  const userConfigEnv = path.join(userConfigDir, 'config.env');
  const userLibLink = path.join(userConfigDir, 'lib');
  const userPgComposeDir = path.join(userConfigDir, 'services', 'postgres');
  const claudeSettings = path.join(home, '.claude', 'settings.json');
  const claudeUserConfig = path.join(home, '.claude.json');
  const opencodeConfig = path.join(home, '.config', 'opencode', 'opencode.json');
  const codexConfig = path.join(home, '.codex', 'config.toml');

  return [
    {
      id: 'project-launcher',
      scope: 'project',
      risk: 'auto',
      label: '.construct/launcher/ launcher directory',
      detect: () => existsAny(launcherDir),
      describe: () => `Removes ${rel(cwd, launcherDir)} (run.mjs, bootstrap shims, version, cache).`,
      remove: () => (removePath(launcherDir) ? 'removed' : 'nothing to remove'),
    },
    {
      id: 'project-agents',
      scope: 'project',
      risk: 'auto',
      label: '.claude/agents/ (Construct worker profiles)',
      detect: () => readManifest(dotClaudeAgents).length > 0,
      describe: () => `Removes ${readManifest(dotClaudeAgents).length} agent file(s) listed in .claude/agents/.construct-manifest.`,
      remove: () => removeManifestEntries(dotClaudeAgents),
    },
    {
      id: 'project-commands',
      scope: 'project',
      risk: 'auto',
      label: '.claude/commands/ (Construct slash commands)',
      detect: () => readManifest(dotClaudeCommands).length > 0,
      describe: () => `Removes ${readManifest(dotClaudeCommands).length} command file(s) listed in .claude/commands/.construct-manifest.`,
      remove: () => removeManifestEntries(dotClaudeCommands),
    },
    {
      id: 'project-settings',
      scope: 'project',
      risk: 'auto',
      label: '.claude/settings.json + .mcp.json (un-merge Construct keys)',
      detect: () => detectProjectSettings(dotClaudeSettings) || detectMcpJson(dotMcpJson),
      describe: () =>
        'Strips the Construct hooks block and known mcpServers from settings.json, and Construct-managed servers from .mcp.json; preserves any user-added keys. Deletes a file if it becomes empty.',
      remove: () => {
        const parts = [unmergeProjectSettings(dotClaudeSettings)];
        const mcpResult = unmergeMcpJson(dotMcpJson);
        if (mcpResult) parts.push(mcpResult);
        return parts.join('; ');
      },
    },
    {
      id: 'project-state',
      scope: 'project',
      risk: 'ask',
      label: '.construct/ (per-project config + session state)',
      detect: () => existsAny(dotConstruct),
      describe: () => `Removes ${rel(cwd, dotConstruct)}. May contain in-progress work.`,
      remove: () => (removePath(dotConstruct) ? 'removed' : 'nothing to remove'),
    },
    {
      id: 'project-scaffold',
      scope: 'project',
      risk: 'ask',
      label: 'AGENTS.md and plan.md',
      detect: () => existsAny(projectAgentsMd) || existsAny(projectPlanMd),
      describe: () => 'Scaffolded by `construct init`. Often heavily edited by users; left alone unless explicitly removed.',
      remove: () => {
        const removed: string[] = [];
        if (removePath(projectAgentsMd)) removed.push('AGENTS.md');
        if (removePath(projectPlanMd)) removed.push('plan.md');
        return removed.length ? `removed ${removed.join(', ')}` : 'nothing to remove';
      },
    },
    {
      id: 'project-git-hookspath',
      scope: 'project',
      risk: 'auto',
      label: 'git core.hooksPath (.beads/hooks)',
      detect: () => gitHooksPathIsConstruct(cwd),
      describe: () => 'Unsets core.hooksPath set by `construct init` to .beads/hooks. A custom hooksPath is left untouched.',
      remove: () => unsetConstructGitHooksPath(cwd),
    },
    {
      id: 'machine-state',
      scope: 'machine',
      risk: 'auto',
      label: `${rel(home, paths.stateDir)} (workspace, vector index, daemon/log state)`,
      detect: () => existsAny(paths.stateDir),
      describe: () => `Removes ${rel(home, paths.stateDir)}. Regenerated on next use.`,
      remove: () => (removePath(paths.stateDir) ? 'removed' : 'nothing to remove'),
    },
    {
      id: 'machine-data',
      scope: 'machine',
      risk: 'auto',
      label: `${rel(home, paths.dataDir)} (shell completions + per-user data)`,
      detect: () => existsAny(paths.dataDir),
      describe: () => `Removes ${rel(home, paths.dataDir)}. Rebuilt on next setup.`,
      remove: () => (removePath(paths.dataDir) ? 'removed' : 'nothing to remove'),
    },
    {
      id: 'machine-cache-embeddings',
      scope: 'machine',
      risk: 'ask',
      label: `${rel(home, userEmbedCache)} (cached embedding model)`,
      detect: () => existsAny(userEmbedCache),
      describe: () => 'Removes the cached embedding model. Skip if reinstalling soon — re-downloading takes a minute.',
      remove: () => (removePath(userEmbedCache) ? 'removed' : 'nothing to remove'),
    },
    {
      id: 'machine-config-env',
      scope: 'machine',
      risk: 'ask',
      label: `${rel(home, userConfigEnv)} (API keys + consent flags)`,
      detect: () => existsAny(userConfigEnv),
      describe: () => 'Removes saved API keys and bootstrap consent. Skip if you intend to reinstall and reuse the keys.',
      remove: () => (removePath(userConfigEnv) ? 'removed' : 'nothing to remove'),
    },
    {
      id: 'machine-lib-symlink',
      scope: 'machine',
      risk: 'auto',
      label: `${rel(home, userLibLink)} (hook lib symlink into the package)`,
      detect: () => isSymlink(userLibLink),
      describe: () => 'Removes the symlink pointed at the installed package lib/. It dangles once the package is uninstalled.',
      remove: () => (removePath(userLibLink) ? 'removed' : 'nothing to remove'),
    },
    {
      id: 'machine-postgres-container',
      scope: 'machine',
      risk: 'ask',
      label: `Docker container "${pgContainerName}" (stop + remove, including data)`,
      detect: () => dockerContainerExists(spawn, pgContainerName) || dockerContainerExists(spawn, LEGACY_PG_CONTAINER),
      describe: () =>
        'Stops and removes the Postgres container and its named data volume. The pgvector image stays cached. This destroys indexed observations — skip if you might restore.',
      remove: () => {
        const results: string[] = [];
        if (dockerContainerExists(spawn, pgContainerName)) {
          results.push(removeDockerContainer(spawn, pgContainerName, `postgres_${pgContainerName}-data`));
        }
        if (dockerContainerExists(spawn, LEGACY_PG_CONTAINER)) {
          results.push(removeDockerContainer(spawn, LEGACY_PG_CONTAINER));
        }
        return results.join(', ') || 'nothing to remove';
      },
    },
    {
      id: 'machine-postgres-compose',
      scope: 'machine',
      risk: 'auto',
      label: `${rel(home, userPgComposeDir)} (compose file)`,
      detect: () => existsAny(userPgComposeDir),
      describe: () => 'Removes the local docker-compose.yml. Run after removing the container.',
      remove: () => (removePath(userPgComposeDir) ? 'removed' : 'nothing to remove'),
    },
    {
      id: 'machine-launchagent',
      scope: 'machine',
      risk: 'auto',
      label: `LaunchAgent ${PRESSURE_GUARD_LABEL} (unload + plist)`,
      detect: () => platform === 'darwin' && existsAny(launchAgentPlist),
      describe: () => `Unregisters the pressure-release LaunchAgent (launchctl bootout) and removes ${rel(home, launchAgentPlist)}.`,
      remove: () => removePressureGuardLaunchAgent(spawn, launchAgentPlist),
    },
    {
      id: 'machine-memory-mcp',
      scope: 'machine',
      risk: 'auto',
      label: 'memory MCP registration (Claude, OpenCode, Codex)',
      detect: () =>
        hasJsonKeys(claudeSettings, 'mcpServers', MEMORY_MCP_IDS)
        || hasJsonKeys(claudeUserConfig, 'mcpServers', MEMORY_MCP_IDS)
        || hasJsonKeys(opencodeConfig, 'mcp', MEMORY_MCP_IDS)
        || hasCodexMcpTables(codexConfig, MEMORY_MCP_IDS),
      describe: () =>
        'Strips the Construct memory MCP bridge from ~/.claude.json, ~/.claude/settings.json (legacy path), ~/.config/opencode/opencode.json, and ~/.codex/config.toml. Preserves all other entries.',
      remove: () => {
        const stripped: string[] = [];
        if (stripJsonKeys(claudeSettings, 'mcpServers', MEMORY_MCP_IDS)) stripped.push('claude settings.json (legacy)');
        if (stripJsonKeys(claudeUserConfig, 'mcpServers', MEMORY_MCP_IDS)) stripped.push('claude.json');
        if (stripJsonKeys(opencodeConfig, 'mcp', MEMORY_MCP_IDS)) stripped.push('opencode');
        if (stripCodexMcpTables(codexConfig, MEMORY_MCP_IDS)) stripped.push('codex');
        return stripped.length ? `stripped from ${stripped.join(', ')}` : 'nothing to strip';
      },
    },
    {
      id: 'machine-pgvector-image',
      scope: 'machine',
      risk: 'ask',
      label: `Docker image "${PGVECTOR_IMAGE}" (--with-images only)`,
      detect: () => withImages && dockerImageExists(spawn, PGVECTOR_IMAGE),
      describe: () => `Removes the cached ${PGVECTOR_IMAGE} image. Off unless --with-images, since other projects may share it.`,
      remove: () => removeDockerImage(spawn, PGVECTOR_IMAGE),
    },
  ];
}

function rel(base: string, target: string): string {
  const r = path.relative(base, target);
  return r || target;
}

function existsAny(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

// statSync follows symlinks, so a link whose target is already gone reports
// absent. Detecting an install-created link needs lstat, or a dangling link
// survives every cleanup run.
function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function removePath(p: string): boolean {
  try {
    fs.rmSync(p, { recursive: true, force: true });
    return true;
  } catch (err) {
    if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

function readManifest(dir: string): string[] {
  const manifestPath = path.join(dir, '.construct-manifest');
  if (!fs.existsSync(manifestPath)) return [];
  return fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean);
}

function removeManifestEntries(dir: string): string {
  const entries = readManifest(dir);
  let removedCount = 0;
  for (const name of entries) {
    if (removePath(path.join(dir, name))) removedCount += 1;
  }
  removePath(path.join(dir, '.construct-manifest'));
  if (fs.existsSync(dir)) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* dir disappeared between checks */
    }
  }
  return `removed ${removedCount} entries`;
}

function readJsonOrNull(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectProjectSettings(filePath: string): boolean {
  const settings = readJsonOrNull(filePath);
  if (!settings) return false;
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (hooks && Object.keys(hooks).length > 0) return true;
  const mcpServers = settings.mcpServers as Record<string, unknown> | undefined;
  return Boolean(mcpServers && KNOWN_PROJECT_MCP_IDS.some((id) => id in mcpServers));
}

function unmergeProjectSettings(filePath: string): string {
  if (!fs.existsSync(filePath)) return 'no settings.json';
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return 'settings.json was malformed; left untouched';
  }

  const changes: string[] = [];
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (hooks && Object.keys(hooks).length > 0) {
    delete settings.hooks;
    changes.push('hooks');
  }
  const mcpServers = settings.mcpServers as Record<string, unknown> | undefined;
  if (mcpServers) {
    let removedMcp = 0;
    for (const id of KNOWN_PROJECT_MCP_IDS) {
      if (id in mcpServers) {
        delete mcpServers[id];
        removedMcp += 1;
      }
    }
    if (Object.keys(mcpServers).length === 0) delete settings.mcpServers;
    if (removedMcp > 0) changes.push(`${removedMcp} mcpServers`);
  }

  const remaining = Object.keys(settings);
  if (remaining.length === 0) {
    fs.unlinkSync(filePath);
    return `removed (file was Construct-only) [stripped: ${changes.join(', ') || 'nothing'}]`;
  }
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return `stripped ${changes.join(', ') || 'nothing'}; preserved ${remaining.join(', ')}`;
}

function detectMcpJson(filePath: string): boolean {
  const config = readJsonOrNull(filePath);
  const mcpServers = config?.mcpServers as Record<string, unknown> | undefined;
  return Boolean(mcpServers && KNOWN_PROJECT_MCP_IDS.some((id) => id in mcpServers));
}

function unmergeMcpJson(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return '.mcp.json was malformed; left untouched';
  }
  const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers) return null;

  let removedCount = 0;
  for (const id of KNOWN_PROJECT_MCP_IDS) {
    if (id in mcpServers) {
      delete mcpServers[id];
      removedCount += 1;
    }
  }
  if (removedCount === 0) return null;
  if (Object.keys(mcpServers).length === 0) delete config.mcpServers;

  const remaining = Object.keys(config);
  if (remaining.length === 0) {
    fs.unlinkSync(filePath);
    return `.mcp.json removed (file was Construct-only) [stripped ${removedCount} mcpServers]`;
  }
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return `.mcp.json stripped ${removedCount} mcpServers; preserved ${remaining.join(', ')}`;
}

function hasJsonKeys(filePath: string, containerKey: string, ids: string[]): boolean {
  const config = readJsonOrNull(filePath);
  const container = config?.[containerKey] as Record<string, unknown> | undefined;
  return Boolean(container && ids.some((id) => id in container));
}

function stripJsonKeys(filePath: string, containerKey: string, ids: string[]): boolean {
  const config = readJsonOrNull(filePath);
  const container = config?.[containerKey] as Record<string, unknown> | undefined;
  if (!config || !container) return false;
  let changed = false;
  for (const id of ids) {
    if (id in container) {
      delete container[id];
      changed = true;
    }
  }
  if (!changed) return false;
  if (Object.keys(container).length === 0) delete config[containerKey];
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return true;
}

// Minimal port of construct-legacy's lib/codex-config.mjs TOML-table remover —
// only what cleanup needs (removing whole `[mcp_servers.<id>]` tables), not
// codex config generation.

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeTomlTables(text: string, tableNames: string[]): string {
  let next = text;
  for (const tableName of tableNames) {
    const pattern = new RegExp(`\\n?\\[${escapeRegExp(tableName)}\\]\\n[\\s\\S]*?(?=\\n\\[|(?![\\s\\S]))`);
    next = next.replace(pattern, '\n');
  }
  return next.replace(/\n{3,}/g, '\n\n').trimEnd();
}

function hasCodexMcpTables(filePath: string, ids: string[]): boolean {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  return ids.some((id) => text.includes(`[mcp_servers.${id}]`) || text.includes(`[mcp_servers.${tomlString(id)}]`));
}

function stripCodexMcpTables(filePath: string, ids: string[]): boolean {
  if (!fs.existsSync(filePath)) return false;
  const existing = fs.readFileSync(filePath, 'utf8');
  const tables = ids.flatMap((id) => [`mcp_servers.${id}`, `mcp_servers.${tomlString(id)}`]);
  const cleaned = removeTomlTables(existing, tables);
  if (cleaned === existing.trimEnd()) return false;
  fs.writeFileSync(filePath, `${cleaned}\n`, 'utf8');
  return true;
}

// core.hooksPath is reversed only when it still points at the value
// `construct init` sets (.beads/hooks); a user who repointed it owns that
// choice and is left alone.

function gitHooksPathIsConstruct(cwd: string): boolean {
  const inGit = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' });
  if (inGit.status !== 0) return false;
  const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, encoding: 'utf8' });
  if (current.status !== 0) return false;
  return (current.stdout || '').trim() === '.beads/hooks';
}

function unsetConstructGitHooksPath(cwd: string): string {
  if (!gitHooksPathIsConstruct(cwd)) return 'core.hooksPath not set to .beads/hooks';
  const result = spawnSync('git', ['config', '--unset', 'core.hooksPath'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || 'git config --unset failed');
  }
  return 'unset core.hooksPath';
}

function dockerContainerExists(spawn: SpawnFn, name: string): boolean {
  const probe = spawn('docker', ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']);
  if (probe.status !== 0) return false;
  return probe.stdout.trim() === name;
}

function removeDockerContainer(spawn: SpawnFn, name: string, namedVolume?: string): string {
  const stop = spawn('docker', ['stop', name]);
  const rm = spawn('docker', ['rm', '-v', name]);
  if (rm.status !== 0) {
    throw new Error(rm.stderr.trim() || 'docker rm failed');
  }
  if (namedVolume) spawn('docker', ['volume', 'rm', namedVolume]);
  return stop.status === 0 ? 'stopped and removed (with volume)' : 'removed (with volume)';
}

function dockerImageExists(spawn: SpawnFn, image: string): boolean {
  return spawn('docker', ['image', 'inspect', image]).status === 0;
}

function removeDockerImage(spawn: SpawnFn, image: string): string {
  const rm = spawn('docker', ['rmi', image]);
  if (rm.status !== 0) {
    throw new Error(rm.stderr.trim() || 'docker rmi failed');
  }
  return `removed image ${image}`;
}

// launchctl bootout takes the GUI domain target; unload is the legacy
// fallback for older macOS. Either deregisters the agent before the plist is
// deleted so a reinstall starts clean.
function removePressureGuardLaunchAgent(spawn: SpawnFn, plistPath: string): string {
  if (!existsAny(plistPath)) return 'no LaunchAgent plist';
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid != null) {
    spawn('launchctl', ['bootout', `gui/${uid}/${PRESSURE_GUARD_LABEL}`]);
  }
  spawn('launchctl', ['unload', plistPath]);
  const removed = removePath(plistPath);
  return removed ? 'unregistered and removed plist' : 'unregistered (plist already gone)';
}
