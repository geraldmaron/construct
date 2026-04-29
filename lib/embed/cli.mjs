/**
 * lib/embed/cli.mjs — CLI handler for `construct embed <subcommand>`.
 *
 * Subcommands:
 *   start    [--config <path>]   Fork detached embed daemon
 *   stop                         Send SIGTERM to running daemon
 *   status                       Print daemon status + last snapshot summary
 *   snapshot [--config <path>]   Run a one-shot snapshot and print to stdout
 *
 * Exports:
 *   resolveEmbedStatus(env, homeDir) — returns { level, label, detail }
 *     level: 'running' | 'stopped' | 'none'
 *     Consumed by session-start hook and dashboard /api/embed/status endpoint.
 *
 *   autoStartEmbedIfNeeded(env, rootDir, homeDir) — spawns daemon when
 *     provider credentials are present but daemon is stopped. No-op if already
 *     running or no credentials. Returns { started: bool, pid?, reason? }.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const STATE_FILE = 'embed-daemon.json';
const LOG_FILE   = 'embed-daemon.log';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function runtimeDir(homeDir = os.homedir()) {
  return path.join(homeDir, '.cx', 'runtime');
}

function statePath(homeDir = os.homedir()) {
  return path.join(runtimeDir(homeDir), STATE_FILE);
}

function logPath(homeDir = os.homedir()) {
  return path.join(runtimeDir(homeDir), LOG_FILE);
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function readState(homeDir = os.homedir()) {
  const p = statePath(homeDir);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeState(obj, homeDir = os.homedir()) {
  const dir = runtimeDir(homeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(homeDir), JSON.stringify(obj, null, 2));
}

function clearState(homeDir = os.homedir()) {
  const p = statePath(homeDir);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

function processExists(pid) {
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function readRunningState(homeDir = os.homedir()) {
  const s = readState(homeDir);
  if (!s) return null;
  if (!processExists(s.pid)) { clearState(homeDir); return null; }
  return s;
}

// ---------------------------------------------------------------------------
// Exported status + auto-start utilities
// ---------------------------------------------------------------------------

/**
 * Resolve embed daemon status without side effects.
 *
 * @param {object} [env]      - Env object (default: process.env)
 * @param {string} [homeDir]  - Home dir override
 * @returns {{ level: 'running'|'stopped'|'none', label: string, detail: string }}
 *   level='none'    — no provider credentials configured; embed not applicable
 *   level='stopped' — credentials present but daemon not running
 *   level='running' — daemon process is live
 */
export function resolveEmbedStatus(env = process.env, homeDir = os.homedir()) {
  const hasProviders = !!(
    env.GITHUB_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN ||
    env.SLACK_BOT_TOKEN ||
    env.LINEAR_API_KEY ||
    (env.JIRA_API_TOKEN && env.JIRA_USER_EMAIL && env.JIRA_BASE_URL)
  );

  if (!hasProviders) {
    return { level: 'none', label: 'embed: no providers', detail: 'no provider credentials in config.env' };
  }

  const state = readRunningState(homeDir);
  if (state) {
    return {
      level: 'running',
      label: `embed: running (pid ${state.pid})`,
      detail: `started ${state.startedAt ?? 'unknown'} · config: ${state.configPath ?? 'auto'}`,
    };
  }

  return {
    level: 'stopped',
    label: 'embed: providers configured, daemon stopped',
    detail: 'run `construct embed start` or set CX_AUTO_EMBED=1',
  };
}

/**
 * Auto-start the embed daemon when credentials are present but daemon is stopped.
 * Silently no-ops if already running or no credentials.
 *
 * @param {object} [env]      - Env object (default: process.env)
 * @param {string} [rootDir]  - Construct root dir (where lib/embed/worker.mjs lives)
 * @param {string} [homeDir]  - Home dir override
 * @returns {{ started: boolean, pid?: number, reason?: string }}
 */
export async function autoStartEmbedIfNeeded(env = process.env, rootDir, homeDir = os.homedir()) {
  if (!env.CX_AUTO_EMBED && env.CX_AUTO_EMBED !== '1') {
    return { started: false, reason: 'CX_AUTO_EMBED not set' };
  }

  const status = resolveEmbedStatus(env, homeDir);
  if (status.level !== 'stopped') {
    return { started: false, reason: status.level === 'running' ? 'already_running' : 'no_providers' };
  }

  const resolvedRoot = rootDir ?? new URL('../..', import.meta.url).pathname;
  try {
    const workerPath = path.join(resolvedRoot, 'lib', 'embed', 'worker.mjs');
    const log = logPath(homeDir);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const fd = fs.openSync(log, 'a');

    const child = spawn(process.execPath, [workerPath], {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...env },
    });
    child.unref();

    writeState({ pid: child.pid, configPath: 'auto', startedAt: new Date().toISOString() }, homeDir);
    return { started: true, pid: child.pid };
  } catch (err) {
    return { started: false, reason: `spawn_failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Parse args helpers
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--config' || args[i] === '-c') && args[i + 1]) {
      flags.config = args[++i];
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Subcommand: start
// ---------------------------------------------------------------------------

async function cmdEmbedStart(args, { homeDir = os.homedir(), rootDir } = {}) {
  const existing = readRunningState(homeDir);
  if (existing) {
    process.stdout.write(`embed daemon already running (pid ${existing.pid})\n`);
    return;
  }

  const { config } = parseArgs(args);
  const configPath = config
    ? path.resolve(config)
    : fs.existsSync(path.join(os.homedir(), '.construct', 'embed.yaml'))
      ? path.join(os.homedir(), '.construct', 'embed.yaml')
      : null;

  const workerPath = path.join(rootDir, 'lib', 'embed', 'worker.mjs');
  const workerArgs = configPath ? [workerPath, '--config', configPath] : [workerPath];
  const log = logPath(homeDir);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'a');

  const child = spawn(process.execPath, workerArgs, {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env },
  });
  child.unref();

  writeState({ pid: child.pid, configPath: configPath ?? 'auto', startedAt: new Date().toISOString() }, homeDir);
  process.stdout.write(`embed daemon started (pid ${child.pid})\n`);
  process.stdout.write(`config: ${configPath ?? 'auto-discover from config.env'}\n`);
  process.stdout.write(`log:    ${log}\n`);
}

// ---------------------------------------------------------------------------
// Subcommand: stop
// ---------------------------------------------------------------------------

function cmdEmbedStop(_args, { homeDir = os.homedir() } = {}) {
  const state = readRunningState(homeDir);
  if (!state) {
    process.stdout.write('embed daemon is not running\n');
    return;
  }
  try {
    process.kill(Number(state.pid), 'SIGTERM');
    clearState(homeDir);
    process.stdout.write(`embed daemon stopped (pid ${state.pid})\n`);
  } catch (err) {
    process.stderr.write(`Failed to stop daemon: ${err.message}\n`);
    clearState(homeDir);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: status
// ---------------------------------------------------------------------------

function cmdEmbedStatus(_args, { homeDir = os.homedir() } = {}) {
  const state = readRunningState(homeDir);
  if (!state) {
    process.stdout.write('embed daemon: stopped\n');
    return;
  }
  process.stdout.write(`embed daemon: running\n`);
  process.stdout.write(`  pid:        ${state.pid}\n`);
  process.stdout.write(`  config:     ${state.configPath}\n`);
  process.stdout.write(`  started at: ${state.startedAt}\n`);
  process.stdout.write(`  log:        ${logPath(homeDir)}\n`);
}

// ---------------------------------------------------------------------------
// Subcommand: snapshot (one-shot, in-process)
// ---------------------------------------------------------------------------

async function cmdEmbedSnapshot(args, { homeDir = os.homedir() } = {}) {
  const { config } = parseArgs(args);
  const configPath = config
    ? path.resolve(config)
    : path.join(os.homedir(), '.construct', 'embed.yaml');

  const { loadEmbedConfig, EMPTY_CONFIG } = await import('./config.mjs');
  const { SnapshotEngine, renderMarkdown } = await import('./snapshot.mjs');
  const { ProviderRegistry } = await import('./providers/registry.mjs');
  const { loadConstructEnv } = await import('../env-config.mjs');

  const env = loadConstructEnv();
  const registry = await ProviderRegistry.fromEnv(env);

  let cfg;
  if (fs.existsSync(configPath)) {
    cfg = loadEmbedConfig(configPath);
  } else {
    cfg = { ...EMPTY_CONFIG, sources: registry.autoSources(env) };
  }

  if (!cfg.sources.length) {
    process.stderr.write('embed snapshot: no sources configured and no credentials found in config.env\n');
    process.exit(1);
  }

  const engine = new SnapshotEngine(registry, cfg);

  process.stderr.write('embed: generating snapshot…\n');
  const snapshot = await engine.generate();
  process.stdout.write(renderMarkdown(snapshot));
  process.stderr.write(`\n${snapshot.summary.totalItems} items, ${snapshot.summary.errorCount} errors\n`);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Entry point called by bin/construct.
 * @param {string[]} args  - argv after 'embed'
 * @param {object}  [opts] - { homeDir, rootDir }
 */
export async function runEmbedCli(args, opts = {}) {
  const sub = args[0];
  const subArgs = args.slice(1);
  const homeDir = opts.homeDir ?? os.homedir();
  const rootDir = opts.rootDir ?? new URL('../..', import.meta.url).pathname;

  switch (sub) {
    case 'start':    return cmdEmbedStart(subArgs, { homeDir, rootDir });
    case 'stop':     return cmdEmbedStop(subArgs, { homeDir });
    case 'status':   return cmdEmbedStatus(subArgs, { homeDir });
    case 'snapshot': return cmdEmbedSnapshot(subArgs, { homeDir });
    default:
      process.stderr.write(
        `Usage: construct embed <start|stop|status|snapshot> [--config <path>]\n`,
      );
      if (sub && sub !== '--help' && sub !== '-h') {
        process.stderr.write(`Unknown subcommand: ${sub}\n`);
        process.exit(1);
      }
  }
}
