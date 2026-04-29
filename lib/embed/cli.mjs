/**
 * lib/embed/cli.mjs — CLI handler for `construct embed <subcommand>`.
 *
 * Subcommands:
 *   start    [--config <path>]   Fork detached embed daemon
 *   stop                         Send SIGTERM to running daemon
 *   status                       Print daemon status + last snapshot summary
 *   snapshot [--config <path>]   Run a one-shot snapshot and print to stdout
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
    : path.join(process.cwd(), 'embed.yaml');

  if (!fs.existsSync(configPath)) {
    process.stderr.write(`embed: config not found: ${configPath}\n`);
    process.stderr.write(`Create embed.yaml or pass --config <path>\n`);
    process.exit(1);
  }

  const workerPath = path.join(rootDir, 'lib', 'embed', 'worker.mjs');
  const log = logPath(homeDir);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'a');

  const child = spawn(process.execPath, [workerPath, '--config', configPath], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env },
  });
  child.unref();

  writeState({ pid: child.pid, configPath, startedAt: new Date().toISOString() }, homeDir);
  process.stdout.write(`embed daemon started (pid ${child.pid})\n`);
  process.stdout.write(`config: ${configPath}\n`);
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
    : path.join(process.cwd(), 'embed.yaml');

  if (!fs.existsSync(configPath)) {
    process.stderr.write(`embed snapshot: config not found: ${configPath}\n`);
    process.exit(1);
  }

  const { loadEmbedConfig } = await import('./config.mjs');
  const { SnapshotEngine, renderMarkdown } = await import('./snapshot.mjs');
  const { ProviderRegistry } = await import('./providers/registry.mjs');

  const cfg = loadEmbedConfig(configPath);
  const registry = await ProviderRegistry.fromEnv(process.env);
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
