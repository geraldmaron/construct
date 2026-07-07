/**
 * lib/embed/cli.mjs — CLI handler for `construct embed <subcommand>`.
 *
 * Subcommands:
 *   start    [--config <path>]   Fork detached embed daemon
 *   stop                         Send SIGTERM to running daemon
 *   status                       Print daemon status + last snapshot summary
 *   snapshot [--config <path>]   Run a one-shot snapshot and print to stdout
 *
 * Embed-capability lifecycle (ADR-0061, LMCP-P2) — per-specialist capability
 * manifests, distinct from the daemon process above:
 *   list                         Available capabilities + per-project enabled state
 *   enable  <id>                 Write .cx/embed/<id>.manifest.json, validate, activate
 *   disable <id>                 Mark a capability disabled (scheduled job stops)
 *   status  <id> [--json]        Bindings/filter/runtime/last-tick for one capability
 *   dry-run <id> [--json]        Resolve the binding chain; no side effects
 *
 * Exports:
 *   resolveEmbedStatus(env, homeDir) — returns { level, label, detail }
 *     level: 'running' | 'stopped' | 'none'
 *     Consumed by session-start hook and `construct embed status`.
 *
 *   autoStartEmbedIfNeeded(env, rootDir, homeDir, cwd) — spawns daemon when
 *     provider credentials are present but daemon is stopped, gated by
 *     CX_AUTO_EMBED (env, wins) or construct.config.json `autoEmbed` (config
 *     fallback, same env > config > default precedence as deployment mode).
 *     No-op if already running or no credentials. Returns
 *     { started: bool, pid?, reason? }.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { configDir } from '../config/xdg.mjs';
import { doctorRoot } from '../config/xdg.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';

const STATE_FILE = 'embed-daemon.json';
const LOG_FILE   = 'embed-daemon.log';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function runtimeDir(homeDir = os.homedir()) {
  return path.join(doctorRoot(homeDir), 'runtime');
}

function statePath(homeDir = os.homedir()) {
  return path.join(runtimeDir(homeDir), STATE_FILE);
}

function logPath(homeDir = os.homedir()) {
  return path.join(runtimeDir(homeDir), LOG_FILE);
}

// ---------------------------------------------------------------------------
// Log rotation
//
// The embed daemon writes its stdout/stderr to a single appended file. The
// file descriptor is opened by the parent process at spawn time; the daemon
// has no opportunity to reopen mid-flight. Rotation therefore happens at
// each daemon spawn: if the existing log exceeds the size cap we shift
// segments (.log → .log.1 → .log.2 → …) and drop the oldest, then the
// spawn opens a fresh empty file.
//
// CONSTRUCT_EMBED_LOG_MAX_MB sets the rotation threshold (default 50 MB).
// CONSTRUCT_EMBED_LOG_KEEP    sets retained segment count (default 3).
// Worst-case disk footprint is (MAX_MB * (KEEP + 1)).
// ---------------------------------------------------------------------------

const DEFAULT_MAX_MB = 50;
const DEFAULT_KEEP = 3;
const HARD_CAP_MAX_MB = 500;     // refuse absurd configured values
const HARD_CAP_KEEP = 20;

function rotationConfig(env = process.env) {
  const maxMbRaw = Number.parseInt(env.CONSTRUCT_EMBED_LOG_MAX_MB ?? '', 10);
  const keepRaw = Number.parseInt(env.CONSTRUCT_EMBED_LOG_KEEP ?? '', 10);
  const maxMb = Number.isFinite(maxMbRaw) && maxMbRaw > 0 ? Math.min(maxMbRaw, HARD_CAP_MAX_MB) : DEFAULT_MAX_MB;
  const keep = Number.isFinite(keepRaw) && keepRaw >= 0 ? Math.min(keepRaw, HARD_CAP_KEEP) : DEFAULT_KEEP;
  return { maxBytes: maxMb * 1024 * 1024, keep };
}

/**
 * Rotate the embed daemon log if it exceeds the size cap. Exported for tests.
 *
 * @param {string} log        - Absolute path to the live log file
 * @param {object} [env]      - Env object (default: process.env)
 * @returns {{ rotated: boolean, sizeBytes: number, droppedSegment?: string }}
 */
export function rotateEmbedLogIfNeeded(log, env = process.env) {
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(log).size;
  } catch (err) {
    if (err.code === 'ENOENT') return { rotated: false, sizeBytes: 0 };
    process.stderr.write(`[cli.mjs] rotateEmbedLog stat: ${err.message}\n`);
    return { rotated: false, sizeBytes: 0 };
  }

  const { maxBytes, keep } = rotationConfig(env);
  if (sizeBytes <= maxBytes) return { rotated: false, sizeBytes };

  // Shift segments oldest-first: .{keep} gets dropped, .{n} → .{n+1}, .log → .log.1
  let droppedSegment;
  try {
    const oldest = `${log}.${keep}`;
    if (keep === 0) {
      // Retention of 0 means rotate-and-discard: the existing log is removed,
      // no segment is kept.
      fs.rmSync(log, { force: true });
      droppedSegment = log;
      return { rotated: true, sizeBytes, droppedSegment };
    }
    if (fs.existsSync(oldest)) {
      fs.rmSync(oldest, { force: true });
      droppedSegment = oldest;
    }
    for (let n = keep - 1; n >= 1; n--) {
      const from = `${log}.${n}`;
      const to = `${log}.${n + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(log, `${log}.1`);
  } catch (err) {
    process.stderr.write(`[cli.mjs] rotateEmbedLog: ${err.message}\n`);
    return { rotated: false, sizeBytes };
  }

  return { rotated: true, sizeBytes, droppedSegment };
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function readState(homeDir = os.homedir()) {
  const p = statePath(homeDir);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (err) { process.stderr.write('[cli.mjs] readState: ' + (err?.message ?? String(err)) + '\n'); return null; }
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
  try { process.kill(Number(pid), 0); return true; } catch (err) { process.stderr.write('[cli.mjs] processExists: ' + (err?.message ?? String(err)) + '\n'); return false; }
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
 * @param {string} [cwd]      - Project dir for the construct.config.json `autoEmbed` fallback
 * @returns {{ started: boolean, pid?: number, reason?: string }}
 */
export async function autoStartEmbedIfNeeded(env = process.env, rootDir, homeDir = os.homedir(), cwd = process.cwd()) {
  let configEnabled = false;
  try {
    const { config } = loadProjectConfig(cwd, env);
    configEnabled = config?.autoEmbed === true;
  } catch { /* loader is best-effort — falls through to env-only gating */ }

  if (env.CX_AUTO_EMBED !== '1' && !configEnabled) {
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
    rotateEmbedLogIfNeeded(log, env);
    const fd = fs.openSync(log, 'a');

    const child = spawn(process.execPath, [workerPath], {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...env },
    });
    child.unref();

    let resolvedRootDir = homeDir;
    try {
      const { resolveRootDir } = await import('./daemon.mjs');
      resolvedRootDir = resolveRootDir(env, process.cwd());
    } catch { /* fall back to homeDir */ }

    writeState({
      pid: child.pid,
      configPath: 'auto',
      startedAt: new Date().toISOString(),
      rootDir: resolvedRootDir,
    }, homeDir);
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

async function cmdEmbedStart(args, { homeDir = os.homedir(), rootDir, _workerPath, _livenessCheckMs = 400 } = {}) {
  const existing = readRunningState(homeDir);
  if (existing) {
    process.stdout.write(`embed daemon already running (pid ${existing.pid})\n`);
    return;
  }

  const { config } = parseArgs(args);
  const configPath = config
    ? path.resolve(config)
    : fs.existsSync(path.join(configDir(), 'embed.yaml'))
      ? path.join(configDir(), 'embed.yaml')
      : null;

  const workerPath = _workerPath ?? path.join(rootDir, 'lib', 'embed', 'worker.mjs');
  if (!fs.existsSync(workerPath)) {
    throw new Error(`embed worker not found at ${workerPath}`);
  }

  const workerArgs = configPath ? [workerPath, '--config', configPath] : [workerPath];
  const log = logPath(homeDir);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  rotateEmbedLogIfNeeded(log, process.env);
  const fd = fs.openSync(log, 'a');

  const child = spawn(process.execPath, workerArgs, {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env },
  });
  fs.closeSync(fd);
  child.unref();

  // Resolve rootDir using the same precedence the spawned worker will so the
  // operator can see which inbox is being watched via `construct embed status`.

  let resolvedRootDir = homeDir;
  try {
    const { resolveRootDir } = await import('./daemon.mjs');
    resolvedRootDir = resolveRootDir(process.env, process.cwd());
  } catch { /* fall back to homeDir */ }

  writeState({
    pid: child.pid,
    configPath: configPath ?? 'auto',
    startedAt: new Date().toISOString(),
    rootDir: resolvedRootDir,
  }, homeDir);

  // Brief liveness check — detects immediate crashes (e.g. missing module, bad config path)
  await new Promise(r => setTimeout(r, _livenessCheckMs));
  if (!processExists(child.pid)) {
    clearState(homeDir);
    throw new Error(`embed worker (pid ${child.pid}) exited immediately — check ${log}`);
  }

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

async function cmdEmbedStatus(_args, { homeDir = os.homedir() } = {}) {
  const state = readRunningState(homeDir);
  if (!state) {
    process.stdout.write('embed daemon: stopped\n');
    return;
  }

  // Re-resolve rootDir using the same precedence the daemon would so the
  // operator sees which inbox is actually being watched (CX_DATA_DIR override,
  // walked-up project root, or homedir fallback).

  let rootDir = state.rootDir;
  if (!rootDir) {
    try {
      const { resolveRootDir } = await import('./daemon.mjs');
      rootDir = resolveRootDir(process.env, process.cwd());
    } catch {
      rootDir = homeDir;
    }
  }

  process.stdout.write(`embed daemon: running\n`);
  process.stdout.write(`  pid:        ${state.pid}\n`);
  process.stdout.write(`  config:     ${state.configPath}\n`);
  process.stdout.write(`  rootDir:    ${rootDir}\n`);
  process.stdout.write(`  inbox:      ${path.join(rootDir, 'inbox')}\n`);
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
    : path.join(configDir(), 'embed.yaml');

  const { loadEmbedConfig, EMPTY_CONFIG } = await import('./config.mjs');
  const { SnapshotEngine, renderMarkdown } = await import('./snapshot.mjs');
  const { ProviderRegistry } = await import('./providers/registry.mjs');
  const { prepareConstructEnv } = await import('../runtime-env.mjs');

  const env = prepareConstructEnv();
  const registry = await ProviderRegistry.fromEnv(env);

  let cfg;
  if (fs.existsSync(configPath)) {
    cfg = loadEmbedConfig(configPath);
  } else {
    const { resolveAutoEmbedSources } = await import('./auto-sources.mjs');
    cfg = { ...EMPTY_CONFIG, sources: resolveAutoEmbedSources({ cwd: process.cwd(), env, registry }) };
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
// Embed-capability lifecycle subcommands (ADR-0061, LMCP-P2)
// ---------------------------------------------------------------------------

function jsonFlag(args) {
  return args.includes('--json');
}

function positionalId(args) {
  return args.find((a) => !a.startsWith('--'));
}

async function cmdCapabilityList(args, { rootDir = process.cwd() } = {}) {
  const { listCapabilities } = await import('./capability-lifecycle.mjs');
  const { capabilities, errors } = listCapabilities({ rootDir });

  if (jsonFlag(args)) {
    process.stdout.write(`${JSON.stringify({ capabilities: capabilities.map((c) => ({
      id: c.id, available: c.available, enabled: c.enabled, source: c.source,
      runtime: c.manifest.embed.runtime, specialist: c.manifest.embed.specialist,
    })), errors }, null, 2)}\n`);
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (!capabilities.length) {
    process.stdout.write('No embed capabilities discovered (pack defaults or .cx/embed/).\n');
  }
  for (const c of capabilities) {
    process.stdout.write(`${c.id}${c.enabled ? ' [enabled]' : ' [available]'} — specialist=${c.manifest.embed.specialist} runtime=${c.manifest.embed.runtime}\n`);
  }
  for (const err of errors) {
    process.stderr.write(`error: ${err}\n`);
  }
  if (errors.length) process.exitCode = 1;
}

async function cmdCapabilityEnable(args, { rootDir = process.cwd() } = {}) {
  const id = positionalId(args);
  if (!id) {
    process.stderr.write('Usage: construct embed enable <id>\n');
    process.exitCode = 1;
    return;
  }

  // --dry-run resolves the binding chain and writes nothing: enable preview
  // must never touch .cx/embed/, matching the ADR "execute nothing" rule.
  if (args.includes('--dry-run')) {
    return cmdCapabilityDryRun(args, { rootDir });
  }

  const { enableCapability } = await import('./capability-lifecycle.mjs');
  const result = enableCapability(id, { rootDir });

  if (!result.ok) {
    process.stderr.write(`embed enable ${id}: invalid manifest\n`);
    for (const err of result.errors) process.stderr.write(`  ${err}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`embed capability '${id}' enabled → ${result.filePath}\n`);
}

async function cmdCapabilityDisable(args, { rootDir = process.cwd() } = {}) {
  const id = positionalId(args);
  if (!id) {
    process.stderr.write('Usage: construct embed disable <id>\n');
    process.exitCode = 1;
    return;
  }

  const { disableCapability } = await import('./capability-lifecycle.mjs');
  const result = disableCapability(id, { rootDir });
  process.stdout.write(result.wasEnabled
    ? `embed capability '${id}' disabled\n`
    : `embed capability '${id}' was not enabled (no-op)\n`);
}

async function cmdCapabilityStatus(args, { rootDir = process.cwd() } = {}) {
  const id = positionalId(args);
  const { capabilityStatus } = await import('./capability-lifecycle.mjs');
  const result = await capabilityStatus(id, { rootDir });

  if (!result.ok) {
    if (jsonFlag(args)) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      for (const err of result.errors) process.stderr.write(`error: ${err}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (jsonFlag(args)) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`embed capability '${id}': ${result.enabled ? 'enabled' : 'available (not enabled)'}\n`);
  process.stdout.write(`  specialist:  ${result.chain.specialist}\n`);
  process.stdout.write(`  providers:   ${result.chain.providerBindings.join(', ')}\n`);
  process.stdout.write(`  filter:      ${result.chain.filter ? JSON.stringify(result.chain.filter) : '(none)'}\n`);
  process.stdout.write(`  framework:   ${result.chain.framework}\n`);
  process.stdout.write(`  authority:   ${result.chain.proposalAuthority}\n`);
  process.stdout.write(`  runtime:     declared=${result.chain.runtime.declared} resolved=${result.chain.runtime.resolved}${result.chain.runtime.reason ? ` (${result.chain.runtime.reason})` : ''}\n`);
  process.stdout.write(`  last tick:   ${result.lastTick ? `${result.lastTick.status}${result.lastTick.reason ? ` (${result.lastTick.reason})` : ''} at ${result.lastTick.tickedAt}` : '(never ticked)'}\n`);
}

async function cmdCapabilityDryRun(args, { rootDir = process.cwd() } = {}) {
  const id = positionalId(args);
  if (!id) {
    process.stderr.write('Usage: construct embed dry-run <id>\n');
    process.exitCode = 1;
    return;
  }

  const { resolveCapabilityChain } = await import('./capability-lifecycle.mjs');
  const result = await resolveCapabilityChain(id, { rootDir });

  if (!result.ok) {
    if (jsonFlag(args)) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      for (const err of result.errors) process.stderr.write(`error: ${err}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (jsonFlag(args)) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`dry-run '${id}' — resolved chain (no side effects):\n`);
  process.stdout.write(`  specialist        → ${result.chain.specialist}\n`);
  process.stdout.write(`  providerBindings  → ${result.chain.providerBindings.join(', ')}\n`);
  process.stdout.write(`  filter            → ${result.chain.filter ? JSON.stringify(result.chain.filter) : '(none)'}\n`);
  process.stdout.write(`  framework         → ${result.chain.framework}\n`);
  process.stdout.write(`  outputContract    → ${result.chain.outputContract}\n`);
  process.stdout.write(`  proposalAuthority → ${result.chain.proposalAuthority}\n`);
  process.stdout.write(`  cadence           → ${result.chain.cadence ? JSON.stringify(result.chain.cadence) : '(event-driven only)'}\n`);
  process.stdout.write(`  runtime           → declared=${result.chain.runtime.declared} resolved=${result.chain.runtime.resolved}${result.chain.runtime.reason ? ` (${result.chain.runtime.reason})` : ''}\n`);
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

  // Capability-lifecycle subcommands (ADR-0061) resolve manifests against the
  // project the operator is standing in, not the Construct package root the
  // daemon-process subcommands above use for locating worker.mjs.
  const capabilityRootDir = opts.capabilityRootDir ?? process.cwd();

  switch (sub) {
    case 'start':       return cmdEmbedStart(subArgs, { homeDir, rootDir, _workerPath: opts._workerPath, _livenessCheckMs: opts._livenessCheckMs });
    case 'stop':        return cmdEmbedStop(subArgs, { homeDir });
    case 'status':
      if (positionalId(subArgs)) return cmdCapabilityStatus(subArgs, { rootDir: capabilityRootDir });
      return cmdEmbedStatus(subArgs, { homeDir });
    case 'snapshot':    return cmdEmbedSnapshot(subArgs, { homeDir });
    case 'migrate-model': return cmdEmbedMigrateModel(subArgs);
    case 'list':        return cmdCapabilityList(subArgs, { rootDir: capabilityRootDir });
    case 'enable':      return cmdCapabilityEnable(subArgs, { rootDir: capabilityRootDir });
    case 'disable':     return cmdCapabilityDisable(subArgs, { rootDir: capabilityRootDir });
    case 'dry-run':     return cmdCapabilityDryRun(subArgs, { rootDir: capabilityRootDir });
    case 'supervise': {
      const { installSupervision } = await import('./supervision.mjs');
      const result = await installSupervision();
      process.stdout.write(`embed daemon supervised via ${result.method}\n`);
      if (result.file) process.stdout.write(`  service file: ${result.file}\n`);
      return;
    }
    case 'unsupervise': {
      const { uninstallSupervision } = await import('./supervision.mjs');
      const result = await uninstallSupervision();
      if (result.wasInstalled) {
        process.stdout.write(`supervision removed (${result.method})\n`);
      } else {
        process.stdout.write(`supervision was not installed\n`);
      }
      return;
    }
    default:
      process.stderr.write(
        `Usage: construct embed <start|stop|status|snapshot|migrate-model|supervise|unsupervise> [--config <path>]\n` +
        `       construct embed <list|enable|disable|status|dry-run> <id> [--json]\n`,
      );
      if (sub && sub !== '--help' && sub !== '-h') {
        process.stderr.write(`Unknown subcommand: ${sub}\n`);
        process.exit(1);
      }
  }
}

/**
 * Reconcile the pgvector schema with the engine's currently-active embedding
 * model and re-embed the corpus. Run this after changing
 * CONSTRUCT_EMBEDDING_MODEL when the new model produces a different
 * dimensionality than the on-disk schema. The pass:
 *   1. Resolves the engine's active model + dim.
 *   2. Reads the actual `construct_embeddings.embedding` column dim from
 *      `pg_attribute` and compares.
 *   3. If they differ AND the operator passed `--apply`, truncates
 *      `construct_embeddings` and re-types the column.
 *   4. Re-runs `syncFileStateToSql` to repopulate embeddings at the new dim.
 *
 * Without `--apply`, prints what would change and exits.
 */
async function cmdEmbedMigrateModel(args) {
  const apply = args.includes('--apply');
  const { getEmbeddingModelInfo } = await import('../storage/embeddings-engine.mjs');
  const { createSqlClient, closeSqlClient } = await import('../storage/backend.mjs');
  const { syncFileStateToSql } = await import('../storage/sync.mjs');

  const info = await getEmbeddingModelInfo();
  const targetDim = info.dimensions;
  process.stdout.write(`Active engine model: ${info.model} (${targetDim}d)\n`);

  const client = createSqlClient(process.env);
  if (!client) {
    process.stderr.write('Postgres was removed; nothing to migrate.\n');
    process.exit(1);
  }

  try {
    const rows = await client`
      SELECT format_type(atttypid, atttypmod) AS pg_type
      FROM pg_attribute
      WHERE attrelid = 'construct_embeddings'::regclass
        AND attname = 'embedding'
        AND NOT attisdropped
    `;
    const declared = rows?.[0]?.pg_type || '';
    const match = declared.match(/vector\((\d+)\)/);
    const schemaDim = match ? Number(match[1]) : null;

    if (schemaDim === null) {
      process.stdout.write(`Schema column type is '${declared}'; cannot migrate automatically. Run migrations first.\n`);
      process.exit(1);
    }
    if (schemaDim === targetDim) {
      process.stdout.write(`Schema is already ${schemaDim}d — nothing to migrate.\n`);
      return;
    }

    process.stdout.write(`Schema declares vector(${schemaDim}); engine produces ${targetDim}d.\n`);
    if (!apply) {
      process.stdout.write('Re-run with --apply to truncate construct_embeddings and re-type the column.\n');
      return;
    }

    process.stdout.write(`Applying migration: TRUNCATE + ALTER COLUMN to vector(${targetDim})…\n`);
    await client.unsafe(
      `BEGIN; TRUNCATE TABLE construct_embeddings; ` +
      `ALTER TABLE construct_embeddings ALTER COLUMN embedding TYPE vector(${targetDim}); COMMIT;`
    );
    process.stdout.write('Re-embedding the corpus…\n');
    const result = await syncFileStateToSql(process.cwd());
    process.stdout.write(
      `Done. embeddingsSynced=${result.embeddingsSynced} model=${result.embeddingModel}\n`
    );

    // Observations share the embedding model/dimension. Re-dimension their
    // column too, then reconcile re-embeds them from the local source so both
    // corpora live in one vector space after a model change.
    await client.unsafe(
      `BEGIN; TRUNCATE TABLE construct_observations; ` +
      `ALTER TABLE construct_observations ALTER COLUMN embedding TYPE vector(${targetDim}); COMMIT;`
    );
    const { reconcileObservationEmbeddings } = await import('./reconcile.mjs');
    const recon = await reconcileObservationEmbeddings(process.cwd());
    process.stdout.write(`Observations reconciled: re-embedded ${recon.reembedded}.\n`);
  } catch (err) {
    process.stderr.write(`migrate-model failed: ${err.message}\n`);
    process.exit(1);
  } finally {
    await closeSqlClient(client);
  }
}
