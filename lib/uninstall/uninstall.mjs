/**
 * lib/uninstall/uninstall.mjs — interactive teardown for Construct state.
 *
 * npm 7+ has no uninstall hook, so this runs as an explicit command the
 * user invokes before `npm uninstall @geraldmaron/construct`. It probes
 * what Construct created (per-project artefacts and per-machine state),
 * groups the findings into categories, and lets the user choose what to
 * remove. Shared resources the user almost certainly uses for other things
 * — Docker itself, Homebrew, the pgvector image, user-installed CLIs —
 * are never touched; they appear in the final report as informational
 * follow-ups.
 *
 * Categories carry a default risk level:
 *   - auto: removed when --yes is passed; included in the interactive list pre-checked
 *   - ask : never auto-removed; interactive list shows them unchecked
 *
 * Per ADR-0027 §Consequences, shared Docker images stay by default because
 * other projects may use the same pgvector base; the pgvector image is removed
 * only under --with-images. The LaunchAgent registration and a Construct-set
 * `core.hooksPath` are reversed because they are state install/init created and
 * own; a user-customized hooksPath is left untouched.
 *
 * Flags:
 *   --dry-run             print the plan, change nothing
 *   --yes                 non-interactive; remove auto-risk items, skip ask-risk items
 *   --yes --all           non-interactive; remove both auto- and ask-risk items
 *   --keep-state          only remove project-scope launcher + adapters; preserve .cx/, ~/.construct, Postgres
 *   --with-images         also remove the shared pgvector Docker image (off by default; ADR-0027)
 *   --scope=project|machine|all   limit which categories are evaluated (default: all)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { multiSelect } from '../tty-prompts.mjs';
import { getUserConfigDir, getUserEnvPath } from '../env-config.mjs';
import { removeTomlTables, tomlString } from '../codex-config.mjs';
import { postgresContainerName, LEGACY_PG_CONTAINER } from '../home-namespace.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..', '..');
const PGVECTOR_IMAGE = 'pgvector/pgvector:pg16';
const PRESSURE_GUARD_LABEL = 'dev.construct.pressure-release';
const MEMORY_MCP_KEYS = ['memory', 'cass'];

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    yes: false,
    all: false,
    keepState: false,
    withImages: false,
    scope: 'all',
    home: os.homedir(),
    cwd: process.cwd(),
  };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--yes' || arg === '-y') args.yes = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--keep-state') args.keepState = true;
    else if (arg === '--with-images') args.withImages = true;
    else if (arg.startsWith('--scope=')) args.scope = arg.slice('--scope='.length);
    else if (arg.startsWith('--home=')) args.home = arg.slice('--home='.length);
    else if (arg.startsWith('--cwd=')) args.cwd = arg.slice('--cwd='.length);
  }
  if (!['project', 'machine', 'all'].includes(args.scope)) {
    throw new Error(`Invalid --scope=${args.scope}; expected project|machine|all`);
  }
  return args;
}

function buildCategories({ cwd, home, withImages = false }) {
  const pgContainerName = postgresContainerName(process.env, home);
  const dotConstruct = path.join(cwd, '.construct');
  const dotClaudeAgents = path.join(cwd, '.claude', 'agents');
  const dotClaudeCommands = path.join(cwd, '.claude', 'commands');
  const dotClaudeSettings = path.join(cwd, '.claude', 'settings.json');
  const dotCx = path.join(cwd, '.cx');
  const projectAgentsMd = path.join(cwd, 'AGENTS.md');
  const projectPlanMd = path.join(cwd, 'plan.md');
  const userHome = home;
  const userConstructDir = getUserConfigDir(userHome);
  const userConfigEnv = getUserEnvPath(userHome);
  const userEmbedCache = path.join(userConstructDir, 'cache', 'embeddings');
  const userVectorIndex = path.join(userConstructDir, 'vector');
  const userWorkspace = path.join(userConstructDir, 'workspace');
  const userPgComposeDir = path.join(userConstructDir, 'services', 'postgres');
  const userCxDir = path.join(userHome, '.cx');
  const launchAgentPlist = path.join(userHome, 'Library', 'LaunchAgents', `${PRESSURE_GUARD_LABEL}.plist`);
  const claudeSettings = path.join(userHome, '.claude', 'settings.json');
  const opencodeConfig = path.join(userHome, '.config', 'opencode', 'opencode.json');
  const codexConfig = path.join(userHome, '.codex', 'config.toml');
  const memoryConfigPaths = { claudeSettings, opencodeConfig, codexConfig };

  return [
    {
      id: 'project-launcher',
      scope: 'project',
      risk: 'auto',
      label: '.construct/ launcher directory',
      detect: () => existsAny(dotConstruct),
      describe: () => `Removes ${rel(cwd, dotConstruct)} (run.mjs, bootstrap shims, version, cache).`,
      execute: () => removePath(dotConstruct),
    },
    {
      id: 'project-agents',
      scope: 'project',
      risk: 'auto',
      label: '.claude/agents/ (Construct personas)',
      detect: () => {
        const manifest = readAgentManifest(dotClaudeAgents);
        return manifest.length > 0;
      },
      describe: () => {
        const manifest = readAgentManifest(dotClaudeAgents);
        return `Removes ${manifest.length} agent files listed in .claude/agents/.construct-manifest.`;
      },
      execute: () => removeManifestEntries(dotClaudeAgents),
    },
    {
      id: 'project-commands',
      scope: 'project',
      risk: 'auto',
      label: '.claude/commands/ (Construct slash commands)',
      detect: () => {
        const manifest = readAgentManifest(dotClaudeCommands);
        return manifest.length > 0;
      },
      describe: () => {
        const manifest = readAgentManifest(dotClaudeCommands);
        return `Removes ${manifest.length} command files listed in .claude/commands/.construct-manifest.`;
      },
      execute: () => removeManifestEntries(dotClaudeCommands),
    },
    {
      id: 'project-settings',
      scope: 'project',
      risk: 'auto',
      label: '.claude/settings.json (un-merge Construct keys)',
      detect: () => detectConstructSettings(dotClaudeSettings),
      describe: () => 'Strips Construct hooks + known mcpServers from settings.json; preserves any user-added keys. Deletes the file if it becomes empty.',
      execute: () => unmergeSettings(dotClaudeSettings),
    },
    {
      id: 'project-cx',
      scope: 'project',
      risk: 'ask',
      label: '.cx/ (per-project session state)',
      detect: () => existsAny(dotCx),
      describe: () => `Removes ${rel(cwd, dotCx)}. May contain in-progress work captured by Construct.`,
      execute: () => removePath(dotCx),
    },
    {
      id: 'project-scaffold-files',
      scope: 'project',
      risk: 'ask',
      label: 'AGENTS.md and plan.md',
      detect: () => existsAny(projectAgentsMd) || existsAny(projectPlanMd),
      describe: () => 'Scaffolded by `construct init`. Often heavily edited by users; left alone unless explicitly removed.',
      execute: () => {
        const removed = [];
        if (removePath(projectAgentsMd)) removed.push('AGENTS.md');
        if (removePath(projectPlanMd)) removed.push('plan.md');
        return removed.length ? `removed ${removed.join(', ')}` : 'nothing to remove';
      },
    },
    {
      id: 'machine-workspace',
      scope: 'machine',
      risk: 'auto',
      label: '~/.construct/workspace and ~/.construct/vector',
      detect: () => existsAny(userWorkspace) || existsAny(userVectorIndex),
      describe: () => 'Removes the per-user working dir and fallback JSON vector index. Both are regenerated on next use.',
      execute: () => {
        const removed = [];
        if (removePath(userWorkspace)) removed.push('workspace/');
        if (removePath(userVectorIndex)) removed.push('vector/');
        return removed.length ? `removed ${removed.join(', ')}` : 'nothing to remove';
      },
    },
    {
      id: 'machine-cx',
      scope: 'machine',
      risk: 'auto',
      label: '~/.cx (daemon state, logs)',
      detect: () => existsAny(userCxDir),
      describe: () => `Removes ${rel(userHome, userCxDir)}. Daemon PIDs, telemetry, setup logs; all regenerated on next setup.`,
      execute: () => removePath(userCxDir),
    },
    {
      id: 'machine-embedding-cache',
      scope: 'machine',
      risk: 'ask',
      label: '~/.construct/cache/embeddings (~22 MB ONNX model)',
      detect: () => existsAny(userEmbedCache),
      describe: () => 'Removes the cached ONNX embedding model. Skip if you plan to reinstall soon — re-downloading takes a minute.',
      execute: () => removePath(userEmbedCache),
    },
    {
      id: 'machine-config-env',
      scope: 'machine',
      risk: 'ask',
      label: '~/.construct/config.env (API keys + consent flags)',
      detect: () => existsAny(userConfigEnv),
      describe: () => 'Removes saved API keys (Anthropic/OpenAI/telemetry/etc.) and bootstrap consent. Skip if you intend to reinstall and reuse the keys.',
      execute: () => removePath(userConfigEnv),
    },
    {
      id: 'machine-postgres-container',
      scope: 'machine',
      risk: 'ask',
      label: `Docker container "${pgContainerName}" (stop + remove, including data)`,
      detect: () => dockerContainerExists(pgContainerName) || dockerContainerExists(LEGACY_PG_CONTAINER),
      describe: () => 'Stops and removes the Postgres container and its named data volume. The pgvector image stays cached. This destroys indexed observations — skip if you might restore.',
      execute: () => {
        const results = [];
        if (dockerContainerExists(pgContainerName)) {
          results.push(removeDockerContainer(pgContainerName, `postgres_${pgContainerName}-data`));
        }
        if (dockerContainerExists(LEGACY_PG_CONTAINER)) {
          results.push(removeDockerContainer(LEGACY_PG_CONTAINER));
        }
        return results.join(', ') || 'nothing to remove';
      },
    },
    {
      id: 'machine-postgres-compose',
      scope: 'machine',
      risk: 'auto',
      label: '~/.construct/services/postgres/ (compose file)',
      detect: () => existsAny(userPgComposeDir),
      describe: () => 'Removes the local docker-compose.yml. Run after removing the container.',
      execute: () => removePath(userPgComposeDir),
    },
    {
      id: 'project-git-hookspath',
      scope: 'project',
      risk: 'auto',
      label: 'git core.hooksPath (.beads/hooks)',
      detect: () => gitHooksPathIsConstruct(cwd),
      describe: () => 'Unsets core.hooksPath set by `construct init` to .beads/hooks. A custom hooksPath is left untouched.',
      execute: () => unsetConstructGitHooksPath(cwd),
    },
    {
      id: 'machine-launchagent',
      scope: 'machine',
      risk: 'auto',
      label: `LaunchAgent ${PRESSURE_GUARD_LABEL} (unload + plist)`,
      detect: () => process.platform === 'darwin' && existsAny(launchAgentPlist),
      describe: () => `Unregisters the pressure-release LaunchAgent (launchctl bootout) and removes ${rel(userHome, launchAgentPlist)}.`,
      execute: () => removePressureGuardLaunchAgent(launchAgentPlist),
    },
    {
      id: 'machine-memory-mcp',
      scope: 'machine',
      risk: 'auto',
      label: 'memory MCP registration (Claude, OpenCode, Codex)',
      detect: () => memoryMcpRegistered(memoryConfigPaths),
      describe: () => 'Strips the Construct memory MCP bridge from ~/.claude/settings.json, ~/.config/opencode/opencode.json, and ~/.codex/config.toml. Preserves all other entries.',
      execute: () => removeMemoryMcp(memoryConfigPaths),
    },
    {
      id: 'machine-pgvector-image',
      scope: 'machine',
      risk: 'ask',
      optIn: true,
      label: `Docker image "${PGVECTOR_IMAGE}" (--with-images only)`,
      detect: () => withImages && dockerImageExists(PGVECTOR_IMAGE),
      describe: () => `Removes the cached ${PGVECTOR_IMAGE} image. Off unless --with-images, since other projects may share it (ADR-0027).`,
      execute: () => removeDockerImage(PGVECTOR_IMAGE),
    },
  ];
}

export async function runUninstall(rawArgs = []) {
  const args = parseArgs(rawArgs);
  const categories = buildCategories({ cwd: args.cwd, home: args.home, withImages: args.withImages });

  const inScope = categories.filter((cat) => {
    if (args.scope !== 'all' && cat.scope !== args.scope) return false;
    if (args.keepState && (cat.scope === 'machine' || cat.id === 'project-cx' || cat.id === 'project-scaffold-files')) return false;
    return cat.detect();
  });

  if (inScope.length === 0) {
    console.log('[uninstall] No Construct state detected in the selected scope. Nothing to do.');
    printFollowups();
    return { removed: [], skipped: [], canceled: false };
  }

  let toRemove;
  if (args.dryRun) {
    printPlan(inScope, args);
    return { removed: [], skipped: inScope.map((c) => c.id), canceled: false, dryRun: true };
  }

  if (args.yes) {
    toRemove = inScope.filter((cat) => cat.risk === 'auto' || cat.optIn || args.all).map((cat) => cat.id);
  } else if (!process.stdin.isTTY) {
    console.error('[uninstall] No TTY available. Re-run with --yes (auto-risk only) or --yes --all (everything).');
    process.exit(2);
  } else {
    const picked = await promptCategories(inScope);
    if (picked === null) {
      console.log('[uninstall] Canceled.');
      return { removed: [], skipped: [], canceled: true };
    }
    toRemove = picked;
  }

  const removed = [];
  const skipped = [];
  for (const cat of inScope) {
    if (!toRemove.includes(cat.id)) {
      skipped.push({ id: cat.id, label: cat.label });
      continue;
    }
    try {
      const detail = cat.execute();
      removed.push({ id: cat.id, label: cat.label, detail: detail || 'removed' });
      console.log(`  ✓ ${cat.label}${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      removed.push({ id: cat.id, label: cat.label, detail: `error: ${err.message}` });
      console.error(`  ✗ ${cat.label} — ${err.message}`);
    }
  }

  console.log('');
  printSummary(removed, skipped);
  printFollowups();
  return { removed, skipped, canceled: false };
}

async function promptCategories(categories) {
  const options = categories.map((cat) => ({
    label: cat.label,
    value: cat.id,
    checked: cat.risk === 'auto' || Boolean(cat.optIn),
    description: cat.describe(),
    meta: cat.risk === 'auto' || cat.optIn ? 'pre-checked' : 'ask',
  }));
  try {
    return await multiSelect({
      title: 'Construct uninstall',
      instructions: 'Space to toggle · a all · i invert · Enter to apply · q to cancel',
      options,
    });
  } catch (err) {
    if (/Canceled/.test(err.message || '')) return null;
    throw err;
  }
}

function printPlan(categories, args) {
  console.log(`[uninstall] dry-run plan (scope=${args.scope}${args.keepState ? ', keep-state' : ''}):`);
  for (const cat of categories) {
    const mark = cat.risk === 'auto' || cat.optIn ? '✓' : '◐';
    console.log(`  ${mark} ${cat.label}`);
    console.log(`      ${cat.describe()}`);
  }
  console.log('');
  console.log('Pass --yes to remove ✓ items, --yes --all to remove both ✓ and ◐, or run without --dry-run for interactive.');
  printFollowups();
}

function printSummary(removed, skipped) {
  console.log(`[uninstall] removed ${removed.length}, skipped ${skipped.length}.`);
}

function printFollowups() {
  console.log('');
  console.log('Follow-ups (run by hand if you want):');
  console.log('  npm uninstall @geraldmaron/construct      # drop the package itself');
  console.log('  construct uninstall --with-images          # also drop the shared pgvector image (kept by default)');
  console.log('  brew uninstall cm cass                     # if installed by `construct init`');
}

function rel(base, target) {
  const r = path.relative(base, target);
  return r || target;
}

function existsAny(p) {
  try { fs.statSync(p); return true; } catch { return false; }
}

function removePath(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

function readAgentManifest(dir) {
  const manifestPath = path.join(dir, '.construct-manifest');
  if (!fs.existsSync(manifestPath)) return [];
  return fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean);
}

function removeManifestEntries(dir) {
  const entries = readAgentManifest(dir);
  let removedCount = 0;
  for (const name of entries) {
    const full = path.join(dir, name);
    if (removePath(full)) removedCount += 1;
  }
  removePath(path.join(dir, '.construct-manifest'));
  if (fs.existsSync(dir)) {
    try {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) fs.rmdirSync(dir);
    } catch { /* dir disappeared between checks */ }
  }
  return `removed ${removedCount} entries`;
}

function detectConstructSettings(filePath) {
  if (!fs.existsSync(filePath)) return false;
  let settings;
  try { settings = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return false; }
  if (!settings || typeof settings !== 'object') return false;
  if (settings.hooks && Object.keys(settings.hooks).length > 0) return true;
  const constructMcp = constructMcpKeys();
  if (settings.mcpServers && constructMcp.some((k) => k in settings.mcpServers)) return true;
  return false;
}

function unmergeSettings(filePath) {
  if (!fs.existsSync(filePath)) return 'no settings.json';
  let settings;
  try { settings = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return 'settings.json was malformed; left untouched'; }

  const changes = [];
  if (settings.hooks && Object.keys(settings.hooks).length > 0) {
    delete settings.hooks;
    changes.push('hooks');
  }
  if (settings.mcpServers) {
    let removedMcp = 0;
    for (const key of constructMcpKeys()) {
      if (key in settings.mcpServers) { delete settings.mcpServers[key]; removedMcp += 1; }
    }
    if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
    if (removedMcp > 0) changes.push(`${removedMcp} mcpServers`);
  }

  const remaining = Object.keys(settings);
  if (remaining.length === 0) {
    fs.unlinkSync(filePath);
    return `removed (file was Construct-only) [stripped: ${changes.join(', ') || 'nothing'}]`;
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return `stripped ${changes.join(', ') || 'nothing'}; preserved ${remaining.join(', ')}`;
}

function constructMcpKeys() {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'specialists', 'registry.json'), 'utf8'));
    return Object.keys(registry.mcpServers || {});
  } catch { return []; }
}

function dockerContainerExists(name) {
  const probe = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) return false;
  return probe.stdout.trim() === name;
}

function removeDockerContainer(name, namedVolume = null) {
  const stop = spawnSync('docker', ['stop', name], { encoding: 'utf8' });
  const rm = spawnSync('docker', ['rm', '-v', name], { encoding: 'utf8' });
  if (rm.status !== 0) {
    throw new Error((rm.stderr || '').trim() || 'docker rm failed');
  }
  if (namedVolume) {
    spawnSync('docker', ['volume', 'rm', namedVolume], { encoding: 'utf8' });
  }
  return stop.status === 0 ? 'stopped and removed (with volume)' : 'removed (with volume)';
}

function dockerImageExists(image) {
  const probe = spawnSync('docker', ['image', 'inspect', image], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return probe.status === 0;
}

function removeDockerImage(image) {
  const rm = spawnSync('docker', ['rmi', image], { encoding: 'utf8' });
  if (rm.status !== 0) {
    throw new Error((rm.stderr || '').trim() || 'docker rmi failed');
  }
  return `removed image ${image}`;
}

// core.hooksPath is reversed only when it still points at the value install/init
// set (.beads/hooks); a user who repointed it owns that choice and is left alone.

function gitHooksPathIsConstruct(cwd) {
  const inGit = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (inGit.status !== 0) return false;
  const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (current.status !== 0) return false;
  return (current.stdout || '').trim() === '.beads/hooks';
}

function unsetConstructGitHooksPath(cwd) {
  if (!gitHooksPathIsConstruct(cwd)) return 'core.hooksPath not set to .beads/hooks';
  const result = spawnSync('git', ['config', '--unset', 'core.hooksPath'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || 'git config --unset failed');
  }
  return 'unset core.hooksPath';
}

// launchctl bootout takes the GUI domain target; unload is the legacy fallback
// for older macOS. Either deregisters the agent before the plist is deleted so a
// reinstall starts clean.

function removePressureGuardLaunchAgent(plistPath) {
  if (!existsAny(plistPath)) return 'no LaunchAgent plist';
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (process.platform === 'darwin') {
    if (uid != null) {
      spawnSync('launchctl', ['bootout', `gui/${uid}/${PRESSURE_GUARD_LABEL}`], { stdio: ['ignore', 'ignore', 'ignore'] });
    }
    spawnSync('launchctl', ['unload', plistPath], { stdio: ['ignore', 'ignore', 'ignore'] });
  }
  const removed = removePath(plistPath);
  return removed ? 'unregistered and removed plist' : 'unregistered (plist already gone)';
}

function memoryMcpRegistered({ claudeSettings, opencodeConfig, codexConfig }) {
  return claudeHasMemoryMcp(claudeSettings)
    || opencodeHasMemoryMcp(opencodeConfig)
    || codexHasMemoryMcp(codexConfig);
}

function claudeHasMemoryMcp(filePath) {
  const settings = readJsonOrNull(filePath);
  if (!settings || !settings.mcpServers) return false;
  return MEMORY_MCP_KEYS.some((key) => key in settings.mcpServers);
}

function opencodeHasMemoryMcp(filePath) {
  const config = readJsonOrNull(filePath);
  if (!config || !config.mcp) return false;
  return MEMORY_MCP_KEYS.some((key) => key in config.mcp);
}

function codexHasMemoryMcp(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8');
  return MEMORY_MCP_KEYS.some((key) => text.includes(`[mcp_servers.${key}]`) || text.includes(`[mcp_servers.${tomlString(key)}]`));
}

// The memory MCP is registered into all three host configs by `construct mcp add
// memory` during install; each host is stripped independently so a missing or
// hand-edited config never blocks the others.

function removeMemoryMcp({ claudeSettings, opencodeConfig, codexConfig }) {
  const stripped = [];
  if (stripMemoryFromJsonMcp(claudeSettings, 'mcpServers')) stripped.push('claude');
  if (stripMemoryFromJsonMcp(opencodeConfig, 'mcp')) stripped.push('opencode');
  if (stripMemoryFromCodex(codexConfig)) stripped.push('codex');
  return stripped.length ? `stripped from ${stripped.join(', ')}` : 'nothing to strip';
}

function stripMemoryFromJsonMcp(filePath, mcpKey) {
  const config = readJsonOrNull(filePath);
  if (!config || !config[mcpKey]) return false;
  let changed = false;
  for (const key of MEMORY_MCP_KEYS) {
    if (key in config[mcpKey]) { delete config[mcpKey][key]; changed = true; }
  }
  if (!changed) return false;
  if (Object.keys(config[mcpKey]).length === 0) delete config[mcpKey];
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return true;
}

function stripMemoryFromCodex(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const existing = fs.readFileSync(filePath, 'utf8');
  const tables = MEMORY_MCP_KEYS.flatMap((key) => [`mcp_servers.${key}`, `mcp_servers.${tomlString(key)}`]);
  const cleaned = removeTomlTables(existing, tables);
  if (cleaned === existing.trimEnd()) return false;
  fs.writeFileSync(filePath, `${cleaned.trimEnd()}\n`, 'utf8');
  return true;
}

function readJsonOrNull(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}
