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
 * follow-up path.
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
  /**
   * True when this item is detected but will deliberately remove nothing —
   * today, when the running Construct owns the directory.
   * Optional: an item that never keeps does not implement it.
   */
  keeps?(): boolean;
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

/**
 * Files only the SUCCESSOR writes.
 *
 * v3 resolves its own directories from the same XDG variables under the same
 * application name, so `~/.local/share/construct` is simultaneously a
 * predecessor trace and the running Construct's home. Removing it wholesale —
 * which is what this catalog did — deletes the store holding every work log
 * entry, task row and raised decision, plus the capability secret. The
 * append-only triggers protect against writes, not against unlink.
 *
 * The signal has to be a file the successor writes rather than a version, because a
 * version file
 * says whoever wrote last rather than who owns the directory. These two are
 * v3's and the predecessor never wrote either: `construct.db` is the node:sqlite
 * substrate introduced in the rewrite, and `capability-secret` is the token
 * signing key from commitment 14.
 *
 * The window opens the moment v3 is installed and could not have been seen
 * before it: until then cleanup only ever ran where v2 was the only Construct.
 */
const SUCCESSOR_MARKERS = ['construct.db', 'capability-secret'];

/** Whether the running Construct owns this directory and must keep it. */
function successorOwns(dir: string): boolean {
  return SUCCESSOR_MARKERS.some((name) => fs.existsSync(path.join(dir, name)));
}

/**
 * A removal that refuses when the successor owns the directory, and says so.
 *
 * Refusing whole-directory removal rather than deleting around the successor's
 * files is the deliberate choice: the predecessor's file list in a shared
 * directory is not knowable from here, so anything selective would be guessing
 * at what to keep. Refusing loudly leaves the operator with stale predecessor
 * files and an accurate sentence, which is strictly better than leaving them
 * with neither those files nor their own.
 */
function removeUnlessSuccessorOwns(dir: string): string {
  if (successorOwns(dir)) {
    return 'kept — the Construct that is running owns this directory (its store or capability secret is here). Any predecessor leftovers inside were NOT removed; remove them by hand if you are sure.';
  }
  return removePath(dir) ? 'removed' : 'nothing to remove';
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
  const userExtractCache = path.join(paths.cacheDir, 'extractions');
  const userConfigEnv = path.join(userConfigDir, 'config.env');
  const userLibLink = path.join(userConfigDir, 'lib');
  const userPgComposeDir = path.join(userConfigDir, 'services', 'postgres');
  // The predecessor's own home directory, distinct from the XDG dirs and from a
  // checkout's `.construct/`. It was in no scope at all until
  // this item existed, which made "zero detected traces" a sentence that could
  // be true with 685MB of v2 still on disk.
  const homeConstruct = path.join(home, '.construct');
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
      describe: () =>
        successorOwns(paths.stateDir)
          ? `KEPT: ${rel(home, paths.stateDir)} belongs to the Construct that is running, not to the predecessor.`
          : `Removes ${rel(home, paths.stateDir)}. Regenerated on next use.`,
      remove: () => removeUnlessSuccessorOwns(paths.stateDir),
      keeps: () => successorOwns(paths.stateDir),
    },
    {
      id: 'machine-data',
      scope: 'machine',
      risk: 'auto',
      label: `${rel(home, paths.dataDir)} (shell completions + per-user data)`,
      detect: () => existsAny(paths.dataDir),
      describe: () =>
        successorOwns(paths.dataDir)
          ? `KEPT: ${rel(home, paths.dataDir)} holds the running Construct's store and capability secret.`
          : `Removes ${rel(home, paths.dataDir)}. Rebuilt on next setup.`,
      remove: () => removeUnlessSuccessorOwns(paths.dataDir),
      keeps: () => successorOwns(paths.dataDir),
    },
    {
      id: 'machine-cache-embeddings',
      scope: 'machine',
      risk: 'ask',
      label: `${rel(home, userEmbedCache)} (cached embedding model)`,
      detect: () => existsAny(userEmbedCache),
      describe: () => 'Removes the cached embedding model. Skip if reinstalling soon — re-downloading takes a minute.',
      remove: () => removeUnlessSuccessorOwns(userEmbedCache),
      keeps: () => successorOwns(userEmbedCache),
    },
    {
      id: 'machine-cache-extractions',
      scope: 'machine',
      risk: 'ask',
      label: `${rel(home, userExtractCache)} (extracted document text)`,
      detect: () => existsAny(userExtractCache),
      describe: () =>
        'Removes text extracted from surveyed binary documents (PDFs, office files). This is the readable contents of documents you grounded runs against — remove it once you are done with them. Re-extracted on the next survey.',
      remove: () => removeUnlessSuccessorOwns(userExtractCache),
      keeps: () => successorOwns(userExtractCache),
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
      id: 'machine-home-construct',
      scope: 'machine',
      // Ask, deliberately. This is the predecessor's accumulated
      // history — per-project traces and vector indexes — not a cache it would
      // rebuild. It is regenerable in the sense that nothing here is a source of
      // truth, and it is also the only place a record of what v2 actually did
      // survives, which is worth one question rather than none. It is the single
      // largest thing cleanup touches, so a silent auto-removal is exactly the
      // kind of surprise the ask tier exists for.
      risk: 'ask',
      label: `${rel(home, homeConstruct)} (per-project traces + vector indexes)`,
      detect: () => existsAny(homeConstruct),
      describe: () =>
        `Removes ${rel(home, homeConstruct)} — the predecessor's per-project traces, vector indexes and hook-call logs (${describeSize(homeConstruct)}). Nothing here is a source of truth, but it is the only surviving record of what v2 did.`,
      remove: () => (removePath(homeConstruct) ? 'removed' : 'nothing to remove'),
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
      label: 'predecessor MCP registrations (Claude, OpenCode, Codex)',
      detect: () =>
        mcpIdsToStrip(claudeSettings, 'mcpServers', MEMORY_MCP_IDS).length > 0
        || mcpIdsToStrip(claudeUserConfig, 'mcpServers', MEMORY_MCP_IDS).length > 0
        || mcpIdsToStrip(opencodeConfig, 'mcp', MEMORY_MCP_IDS).length > 0
        || hasCodexMcpTables(codexConfig, codexIdsToStrip(codexConfig, MEMORY_MCP_IDS)),
      describe: () =>
        'Strips every MCP server that launches the predecessor — matched by the command it runs, not by what it is named — from ~/.claude.json, ~/.claude/settings.json (legacy path), ~/.config/opencode/opencode.json, and ~/.codex/config.toml. Preserves all other entries.',
      remove: () => {
        const stripped: string[] = [];
        const strip = (file: string, key: string): boolean =>
          stripJsonKeys(file, key, mcpIdsToStrip(file, key, MEMORY_MCP_IDS));
        if (strip(claudeSettings, 'mcpServers')) stripped.push('claude settings.json (legacy)');
        if (strip(claudeUserConfig, 'mcpServers')) stripped.push('claude.json');
        if (strip(opencodeConfig, 'mcp')) stripped.push('opencode');
        if (stripCodexMcpTables(codexConfig, codexIdsToStrip(codexConfig, MEMORY_MCP_IDS)))
          stripped.push('codex');
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

/**
 * One detected predecessor marker in the project tree, for `doctor` to name —
 * an id to key on and a ready-to-print line naming what was found and where
 * to send it.
 */
export interface ProjectLitterFinding {
  readonly id: string;
  readonly detail: string;
}

// buildCleanupCatalog's shape asks for a home directory and XDG Paths even
// though no project-scope item's detect() reads either — only the
// machine-scope items do, and doctor never looks at those. These placeholders
// are never dereferenced by anything projectTreeLitter walks; they exist only
// so the catalog can be built once and filtered, instead of a second,
// hand-copied list of "what counts as project litter" drifting from the one
// `construct cleanup` actually acts on.
const PROJECT_ONLY_PATHS: Paths = { configDir: '', stateDir: '', dataDir: '', cacheDir: '' };

/**
 * Predecessor markers detectable in a project tree by itself, with no home
 * directory or spawned process required — the subset `doctor` can report on.
 * Built from the same catalog `construct cleanup --scope=project` acts on, so
 * a marker is taught once and the two surfaces cannot disagree about what
 * counts as a trace. Detection only: nothing here removes anything.
 */
export function projectTreeLitter(cwd: string): ProjectLitterFinding[] {
  const items = buildCleanupCatalog({ cwd, home: '', paths: PROJECT_ONLY_PATHS });
  return items
    .filter((item) => item.scope === 'project' && item.detect())
    .map((item) => ({
      id: item.id,
      detail: `${item.label} — run \`construct cleanup --scope=project\` to review`,
    }));
}

function rel(base: string, target: string): string {
  const r = path.relative(base, target);
  return r || target;
}

/**
 * A human-readable size for a directory, for an ask-risk prompt that should say
 * what it is about to take. Best-effort: an unreadable entry is skipped rather
 * than thrown, because failing to describe something must never stop cleanup
 * from offering to remove it.
 */
function describeSize(dir: string): string {
  let bytes = 0;
  const walk = (p: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(dir);
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
  if (mb >= 1) return `${Math.round(mb)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
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

/**
 * Whether one hook command belongs to the predecessor.
 *
 * Matched on WHAT IT POINTS AT rather than on a list of hook names. Every hook
 * v2's `construct init` wrote runs through its own launcher — `.construct/run.mjs`
 * or `.construct/launcher/run.mjs`, with the hook's name as an argument — so the
 * launcher path is the durable signature. A name list would have to be kept in
 * sync with a catalog that no longer ships, and the day it fell behind would be
 * invisible: an unmatched hook is silently left behind, and an over-broad match
 * silently deletes someone's own work.
 *
 * Verified against the real settings.json files this machine still carries, which
 * include both spellings and, in two projects, user-authored hooks sitting in the
 * same block — `node -e "…"` JSON validators that must survive.
 */
function isPredecessorHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  // The launcher, under either layout. Anchored on `.construct/` so a path that
  // merely contains the word "construct" — this repo's own scripts/hooks/ — does
  // not match.
  return /(^|[\s"'/])\.construct\/(launcher\/)?run\.mjs(\s|"|'|$)/.test(command);
}

/** Hook entries whose every command is the predecessor's. */
function partitionHooks(hooks: Record<string, unknown>): {
  readonly kept: Record<string, unknown>;
  readonly removed: number;
} {
  const kept: Record<string, unknown> = {};
  let removed = 0;

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      kept[event] = entries;
      continue;
    }
    const keptEntries: unknown[] = [];
    for (const entry of entries) {
      const inner = (entry as { hooks?: unknown } | null)?.hooks;
      if (!Array.isArray(inner)) {
        // The flat shape: an entry carrying its command directly rather than a
        // matcher wrapping a hooks[]. Both occur — the settings.json files on
        // this machine use the nested form, while v2 also wrote this one — and a
        // partition that understood only one would silently keep the other.
        if (isPredecessorHookCommand((entry as { command?: unknown } | null)?.command)) {
          removed += 1;
          continue;
        }
        keptEntries.push(entry);
        continue;
      }
      const keptInner = inner.filter(
        (h) => !isPredecessorHookCommand((h as { command?: unknown } | null)?.command),
      );
      removed += inner.length - keptInner.length;
      // An entry whose hooks were ALL the predecessor's carries nothing but a
      // matcher now, so it goes; one that kept any is rewritten around them.
      if (keptInner.length > 0) keptEntries.push({ ...(entry as object), hooks: keptInner });
    }
    if (keptEntries.length > 0) kept[event] = keptEntries;
  }

  return { kept, removed };
}

function detectProjectSettings(filePath: string): boolean {
  const settings = readJsonOrNull(filePath);
  if (!settings) return false;
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  // Only the predecessor's own hooks count as a trace. Treating any hooks block
  // as Construct's is what made this item delete a checkout's own tooling.
  if (hooks && partitionHooks(hooks).removed > 0) return true;
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
    const { kept, removed } = partitionHooks(hooks);
    if (removed > 0) {
      // Only the predecessor's hooks go. What remains is written back rather
      // than dropped, and the key disappears only when it is genuinely empty.
      if (Object.keys(kept).length > 0) settings.hooks = kept;
      else delete settings.hooks;
      changes.push(`${String(removed)} hook(s)`);
    }
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
  // Deleted only when this function is what emptied it. A file that arrived
  // empty was not the predecessor's, and removing it would be cleanup taking
  // something it never put there.
  if (remaining.length === 0 && changes.length > 0) {
    fs.unlinkSync(filePath);
    return `removed (file was Construct-only) [stripped: ${changes.join(', ')}]`;
  }
  if (changes.length === 0) return 'no Construct keys found; left untouched';
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


/**
 * Whether an MCP server entry launches the PREDECESSOR.
 *
 * Matched on the command it runs, not on what it is called. The id list this
 * replaces held `['memory', 'cass']`, and v2's orchestration server is
 * registered as `construct-mcp`, so cleanup walked past the single strongest
 * surface the predecessor has: a connected, tool-serving endpoint. It is not
 * dormant either — OpenCode cannot isolate MCP servers, so a v3
 * role dispatched there sees v2's tools, and one did.
 *
 * The signature is the predecessor's `lib/mcp/server.mjs`, which is a fact about
 * its package layout rather than about anyone's naming. v3 has no `lib/` at all
 * (it ships `bin/` and `dist/`), so this cannot match the successor even though
 * the two now share a package name.
 */
function isPredecessorMcpEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const record = entry as { command?: unknown; args?: unknown };
  const parts: unknown[] = [
    ...(Array.isArray(record.command) ? record.command : [record.command]),
    ...(Array.isArray(record.args) ? record.args : []),
  ];
  return parts.some(
    (part) => typeof part === 'string' && /construct\/lib\/mcp\/server\.mjs/.test(part),
  );
}

/** Ids in `container` whose entry launches the predecessor. */
function predecessorMcpIds(container: Record<string, unknown>): string[] {
  return Object.keys(container).filter((id) => isPredecessorMcpEntry(container[id]));
}

/**
 * Every id worth stripping from one MCP container: the historically-named
 * bridges, plus anything that actually points at the predecessor whatever it is
 * called. The union is deliberate — the id list still catches an entry whose
 * command has been rewritten by hand, and the path check catches the names
 * nobody wrote down.
 */
function mcpIdsToStrip(filePath: string, containerKey: string, ids: string[]): string[] {
  const config = readJsonOrNull(filePath);
  const container = config?.[containerKey] as Record<string, unknown> | undefined;
  if (!container) return [];
  return [...new Set([...ids.filter((id) => id in container), ...predecessorMcpIds(container)])];
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

/**
 * Codex's equivalent of predecessorMcpIds. Its config is TOML
 * and this file carries only a minimal table remover, not a parser, so the scan
 * is textual: find each `[mcp_servers.<id>]` header and look for the
 * predecessor's server path before the next table begins.
 *
 * Textual is honest here rather than lazy — a wrong answer errs toward NOT
 * matching, which leaves a trace behind for the operator to see, instead of
 * deleting a table this code misread.
 */
function codexIdsToStrip(filePath: string, ids: string[]): string[] {
  if (!fs.existsSync(filePath)) return [...ids];
  const text = fs.readFileSync(filePath, 'utf8');
  const found = new Set(ids);
  const header = /^\s*\[mcp_servers\.(?:"([^"]+)"|([^\]\s]+))\]\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = header.exec(text)) !== null) {
    const id = match[1] ?? match[2];
    const rest = text.slice(match.index + match[0].length);
    const nextTable = rest.search(/^\s*\[/m);
    const body = nextTable === -1 ? rest : rest.slice(0, nextTable);
    if (/construct\/lib\/mcp\/server\.mjs/.test(body)) found.add(id);
  }
  return [...found];
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
