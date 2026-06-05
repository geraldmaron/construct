#!/usr/bin/env node
/**
 * lib/setup.mjs — Machine-scoped first-run setup wizard for Construct.
 *
 * Installs cm/cass, configures managed defaults, starts local Postgres
 * (consent-driven), pre-warms the embedding model, wires MCP integrations,
 * and writes ~/.construct/config.env. Invoked by `construct install` and
 * by lib/install/first-invocation.mjs when a TTY user is missing resources.
 *
 * Project-scoped scaffolding (`.cx/`, AGENTS.md, plan.md, adapters) lives
 * in lib/init-unified.mjs — invoked by `construct init`. These two flows
 * are intentionally separate: install runs once per machine, init runs
 * once per repo.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { ensureUserConfigDir, getUserEnvPath, writeEnvValues } from './env-config.mjs';
import { DEFAULT_WORKSPACE_PATH, WORKSPACE_DOCS_LANES } from './embed/config.mjs';
import {
  DEFAULT_DEPLOYMENT_MODE,
  DEPLOYMENT_MODE_ENV_KEY,
  getDeploymentMode,
} from './deployment-mode.mjs';
import { getCanonicalOpenCodeConfigPath, readOpenCodeConfig, writeOpenCodeConfig } from './opencode-config.mjs';
import { syncFileStateToSql } from './storage/sync.mjs';
import { runMigrations } from './storage/migrations.mjs';
import { createSqlClient, closeSqlClient } from './storage/backend.mjs';
import { getEmbeddingModelInfo, warmupEmbeddingModel } from './storage/embeddings-engine.mjs';
import { restoreConstructDb } from './storage/postgres-backup.mjs';
import { buildPressureGuardValues, installPressureGuardLaunchAgent, loadPressureGuardLaunchAgent } from './runtime-pressure.mjs';
import { consentToInstall } from './setup-prompts.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const HOME = os.homedir();
const LOCAL_POSTGRES_PORT = '54329';
const LOCAL_POSTGRES_USER = 'construct';
const LOCAL_POSTGRES_PASSWORD = 'construct';
const LOCAL_POSTGRES_DB = 'construct';
const LOCAL_DATABASE_URL = `postgresql://${LOCAL_POSTGRES_USER}:${LOCAL_POSTGRES_PASSWORD}@127.0.0.1:${LOCAL_POSTGRES_PORT}/${LOCAL_POSTGRES_DB}`;

function printHelp() {
  console.log(`Construct install — machine setup (once per machine)

Usage:
  construct install [--yes] [--no-docker] [--reconfigure]

Flags:
  --yes          accept detected defaults without prompting
  --no-docker    skip local Postgres / Docker service setup
  --reconfigure  re-prompt for service consent, ignoring cached answers

What it does:
  - creates ~/.construct/config.env
  - ensures OpenCode config exists
  - configures managed defaults for local vector retrieval
  - starts local Postgres with Docker when available
  - checks required runtime tools and installs cm and cass when available
  - wires Memory, GitHub, and telemetry configuration
  - runs construct sync (which also regenerates AUTO docs regions)
  - runs construct doctor
  - detects the project tech stack and writes .cx/project-profile.json

For project setup (once per repo): construct init`);
}

function runConstruct(argsList, { optional = false } = {}) {
  const result = spawnSync(process.execPath, [path.join(ROOT_DIR, 'bin', 'construct'), ...argsList], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0 && optional) {
    console.log(`\nOptional setup step skipped: construct ${argsList.join(' ')}`);
    return;
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findCommand(command) {
  const result = spawnSync('zsh', ['-lc', `command -v ${command}`], {
    encoding: 'utf8',
    env: process.env,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function defaultVectorIndexPath(homeDir = HOME) {
  return path.join(homeDir, '.construct', 'vector', 'index.json');
}

export async function buildManagedSetupValues({ homeDir = HOME, env = process.env, databaseUrl = '' } = {}) {
  const modelInfo = await getEmbeddingModelInfo({ env });

  const values = {
    CONSTRUCT_TRACE_BACKEND: env.CONSTRUCT_TRACE_BACKEND || 'local',
    CONSTRUCT_VECTOR_INDEX_PATH: env.CONSTRUCT_VECTOR_INDEX_PATH || defaultVectorIndexPath(homeDir),
    CONSTRUCT_VECTOR_MODEL: env.CONSTRUCT_VECTOR_MODEL || modelInfo.model,
    ...buildPressureGuardValues({ env }),
  };
  // Deployment mode is persisted in construct.config.json — setup never writes
  // CONSTRUCT_DEPLOYMENT_MODE to ~/.construct/config.env. The env var is
  // reserved for ephemeral runtime overrides (CI/scripts via `export …`).
  // Forwarding it here pinned the env value and silently masked any JSON
  // setter that ran later.
  if (env[DEPLOYMENT_MODE_ENV_KEY] && getDeploymentMode(env) !== DEFAULT_DEPLOYMENT_MODE) {
    values[DEPLOYMENT_MODE_ENV_KEY] = getDeploymentMode(env);
  }

  if (env.CONSTRUCT_TELEMETRY_URL) values.CONSTRUCT_TELEMETRY_URL = env.CONSTRUCT_TELEMETRY_URL;
  if (env.CONSTRUCT_TELEMETRY_PUBLIC_KEY) values.CONSTRUCT_TELEMETRY_PUBLIC_KEY = env.CONSTRUCT_TELEMETRY_PUBLIC_KEY;
  if (env.CONSTRUCT_TELEMETRY_SECRET_KEY) values.CONSTRUCT_TELEMETRY_SECRET_KEY = env.CONSTRUCT_TELEMETRY_SECRET_KEY;

  const resolvedDatabaseUrl = databaseUrl || env.DATABASE_URL || '';
  if (resolvedDatabaseUrl) values.DATABASE_URL = resolvedDatabaseUrl;
  if (env.CONSTRUCT_VECTOR_URL) values.CONSTRUCT_VECTOR_URL = env.CONSTRUCT_VECTOR_URL;
  return values;
}

export function localPostgresComposePath(homeDir = HOME) {
  return path.join(homeDir, '.construct', 'services', 'postgres', 'docker-compose.yml');
}

export function writeLocalPostgresCompose(homeDir = HOME) {
  const composePath = localPostgresComposePath(homeDir);
  fs.mkdirSync(path.dirname(composePath), { recursive: true });
  const content = `services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: construct-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${LOCAL_POSTGRES_USER}
      POSTGRES_PASSWORD: ${LOCAL_POSTGRES_PASSWORD}
      POSTGRES_DB: ${LOCAL_POSTGRES_DB}
    ports:
      - "127.0.0.1:${LOCAL_POSTGRES_PORT}:5432"
    volumes:
      - construct-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${LOCAL_POSTGRES_USER} -d ${LOCAL_POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 20

volumes:
  construct-postgres-data:
`;
  fs.writeFileSync(composePath, content, 'utf8');
  return composePath;
}

function runQuiet(command, args, { env = process.env, spawn = spawnSync } = {}) {
  const result = spawn(command, args, {
    env,
    stdio: 'ignore',
  });
  return result;
}

async function runAsyncQuiet(command, args, { env = process.env, spawn = spawn } = {}) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ status: -1, signal: 'SIGTERM' }); // treat timeout as error
    }, 5000);
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ status: code || 0, signal, stdout, stderr });
    });
  });
}

export function commandExists(command, { env = process.env, spawn = spawnSync } = {}) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  return runQuiet(checker, [command], { env, spawn }).status === 0;
}

function summarizeSpawnFailure(result, fallback) {
  return (result.stderr || result.stdout || fallback).trim().split('\n')[0];
}

export function ensureCmInstalled({ env = process.env, spawn = spawnSync } = {}) {
  if (commandExists('cm', { env, spawn })) {
    return { status: 'available', message: 'cm already installed.' };
  }

  if (commandExists('brew', { env, spawn })) {
    const result = runQuiet('brew', ['install', 'dicklesworthstone/tap/cm'], { env, spawn });
    if (result.status === 0 && commandExists('cm', { env, spawn })) {
      return { status: 'installed', message: 'Installed cm via Homebrew.' };
    }
    return {
      status: 'failed',
      message: summarizeSpawnFailure(result, 'brew install failed'),
      installCommand: 'brew install dicklesworthstone/tap/cm',
    };
  }

  return {
    status: 'missing',
    message: 'Homebrew not available.',
    installCommand: 'brew install dicklesworthstone/tap/cm',
  };
}

// Version 0.3.0 has a known issue where the FTS-rebuild loop can OOM on large corpora and fail to converge.
// Version 0.4.0 resolves this. Below this version, we fail closed to avoid the problem.
const CASS_MIN_VERSION = '0.4.0';

function parseSemver(s) {
  const m = String(s || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function semverGte(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) {
    if (x[i] > y[i]) return true;
    if (x[i] < y[i]) return false;
  }
  return true;
}

function getCassVersion({ env, spawn }) {
  const result = runQuiet('cass', ['--version'], { env, spawn });
  if (result.status !== 0) return null;
  const match = String(result.stdout || '').match(/cass\s+(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

export function ensureCassInstalled({ env = process.env, spawn = spawnSync } = {}) {
  if (commandExists('cass', { env, spawn })) {
    const version = getCassVersion({ env, spawn });
    if (version && semverGte(version, CASS_MIN_VERSION)) {
      return { status: 'available', message: `cass ${version} already installed.` };
    }
    return {
      status: 'outdated',
      message: `cass ${version || 'unknown'} is older than required ${CASS_MIN_VERSION}. Older versions hit a frankensqlite FTS-rebuild OOM loop on large session corpora (upstream #168, #186, #110, #155).`,
      installCommand: 'brew upgrade dicklesworthstone/tap/cass || brew install dicklesworthstone/tap/cass',
    };
  }

  if (commandExists('brew', { env, spawn })) {
    const result = runQuiet('brew', ['install', 'dicklesworthstone/tap/cass'], { env, spawn });
    if (result.status === 0 && commandExists('cass', { env, spawn })) {
      runQuiet('cass', ['index'], { env, spawn });
      return { status: 'installed', message: 'Installed cass via Homebrew and ran cass index.' };
    }
    return {
      status: 'failed',
      message: summarizeSpawnFailure(result, 'brew install failed'),
      installCommand: 'brew install dicklesworthstone/tap/cass && cass index',
    };
  }

  if (commandExists('cargo', { env, spawn })) {
    const result = runQuiet('cargo', ['install', 'cass'], { env, spawn });
    if (result.status === 0 && commandExists('cass', { env, spawn })) {
      runQuiet('cass', ['index'], { env, spawn });
      return { status: 'installed', message: 'Installed cass via cargo and ran cass index.' };
    }
    return {
      status: 'failed',
      message: summarizeSpawnFailure(result, 'cargo install failed'),
      installCommand: 'cargo install cass && cass index',
    };
  }

  return {
    status: 'missing',
    message: 'Neither Homebrew nor cargo available.',
    installCommand: 'brew install dicklesworthstone/tap/cass && cass index',
  };
}

/**
 * Platform-aware install hint shown when Docker isn't on PATH. Mirrors
 * what `supabase start` / `prisma init` print: don't auto-install, but
 * point at the canonical option for the user's OS so they have a one-line
 * command to copy.
 */
export function dockerInstallHint(platform = process.platform) {
  if (platform === 'darwin') {
    return 'Install Docker Desktop (https://www.docker.com/products/docker-desktop) or a lighter alternative like OrbStack (`brew install orbstack`) or Colima (`brew install colima && colima start`).';
  }
  if (platform === 'win32') {
    return 'Install Docker Desktop for Windows (https://www.docker.com/products/docker-desktop).';
  }
  return 'Install Docker Engine (https://docs.docker.com/engine/install/) — your distribution likely has a `docker` package (apt/dnf/pacman).';
}

export function detectDockerCompose({ env = process.env, spawn = spawnSync } = {}) {
  // Use a timeout wrapper so we don't block forever if Docker daemon is hung/missing
  const timeoutWrap = (fn) => {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; }, 5000);
    try {
      const result = fn();
      clearTimeout(timer);
      return timedOut ? null : result;
    } catch {
      clearTimeout(timer);
      return null;
    }
  };

  const docker = timeoutWrap(() => runQuiet('docker', ['info'], { env, spawn }));
  if (!docker || docker.status !== 0) return null;
  const compose = timeoutWrap(() => runQuiet('docker', ['compose', 'version'], { env, spawn }));
  if (compose && compose.status === 0) return { command: 'docker', argsPrefix: ['compose'] };
  const dockerCompose = timeoutWrap(() => runQuiet('docker-compose', ['version'], { env, spawn }));
  if (dockerCompose && dockerCompose.status === 0) return { command: 'docker-compose', argsPrefix: [] };
  return null;
}

// Duplicated from service-manager.spawnDetached to avoid the import cycle
// setup ↔ service-manager (service-manager already imports detectDockerCompose
// from setup, so the reverse path can't exist).

function spawnDetachedForSetup(command, args, homeDir, logFile, options = {}) {
  const logDir = path.join(homeDir, '.construct', 'runtime');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, logFile);
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', fd, fd],
    cwd: options.cwd,
    env: options.env,
  });
  child.unref();
  return { child, logPath };
}

export function startManagedPostgres({ homeDir = HOME, env = process.env, spawn = spawnSync } = {}) {
  const composeRunner = detectDockerCompose({ env, spawn });
  if (!composeRunner) {
    return {
      status: 'skipped',
      databaseUrl: env.DATABASE_URL || '',
      message: 'Docker is not available; using existing DATABASE_URL if configured.',
    };
  }

  const composePath = writeLocalPostgresCompose(homeDir);
  const result = runQuiet(
    composeRunner.command,
    [...composeRunner.argsPrefix, '-f', composePath, 'up', '-d', 'postgres'],
    { env, spawn },
  );

  if (result.status !== 0) {
    return {
      status: 'degraded',
      databaseUrl: env.DATABASE_URL || '',
      composePath,
      message: (result.stderr || result.stdout || 'Docker compose failed').trim(),
    };
  }

  return {
    status: 'ok',
    databaseUrl: LOCAL_DATABASE_URL,
    composePath,
    message: 'Managed local Postgres is running.',
  };
}

async function waitForSqlReady(env, { attempts = 20, delayMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const client = createSqlClient(env);
    try {
      await client`select 1 as ok`;
      await closeSqlClient(client);
      return true;
    } catch {
      await closeSqlClient(client).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

function warnIfGlobalCommandIsUnavailable() {
  const globalConstruct = findCommand('construct');
  if (!globalConstruct) {
    console.log('\nInstall warning: `construct` is not on PATH yet.');
    console.log('  From this checkout, run: npm install -g .');
    console.log('  Without cloning, run: npm install -g github:geraldmaron/construct');
    console.log('  Do not use `npm install -g construct`; that npm name belongs to another project.');
    return;
  }

  const version = spawnSync(globalConstruct, ['version'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (version.status !== 0 || !/^construct v\d+\./.test(version.stdout.trim())) {
    console.log(`\nInstall warning: PATH resolves \`construct\` to ${globalConstruct}, but it does not look like this CLI.`);
    console.log('  Reinstall from this checkout with: npm install -g .');
    console.log('  Or install from GitHub with: npm install -g github:geraldmaron/construct');
  }
}

function ensureOpenCodeConfig() {
  const current = readOpenCodeConfig();
  if (current.config) return current.file;
  writeOpenCodeConfig({
    $schema: 'https://opencode.ai/config.json',
    mcp: {},
    agent: {},
  }, getCanonicalOpenCodeConfigPath());
  return getCanonicalOpenCodeConfigPath();
}

// Wire core.hooksPath to .beads/hooks so the tracked hook scripts (ECC
// secret-scan, Construct policy gates, BEADS dispatcher) actually fire on
// git commit/push. Without this, .beads/hooks/* are inert — present in the
// repo but never executed by git. Idempotent: leaves a user-set value alone
// rather than clobbering it.

// Project-scoped git-hooks wiring lives in its own module and is owned by
// `construct init`. Re-exported here for importers that reference it via
// setup.mjs (e.g. tests/setup-git-hooks-path.test.mjs). `construct install`
// must never mutate the cwd repo (ADR-0027 §3), so the install flow leaves
// hooks wiring to init.

export { ensureGitHooksPath } from './git-hooks-path.mjs';

// $HOME/.construct/lib/hooks/* is the resolution path for Claude Code
// Stop-hook commands. Absent symlink → every Stop hook fails silently,
// including stop-notify (dashboard cost feed). Idempotent: matching
// symlink left alone, stale symlink replaced, real dir refused.

export function ensureLibSymlink({ homeDir = HOME, rootDir = ROOT_DIR } = {}) {
  const target = path.join(homeDir, '.construct', 'lib');
  const source = path.join(rootDir, 'lib');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let stat = null;
  try { stat = fs.lstatSync(target); } catch { stat = null; }
  if (!stat) {
    fs.symlinkSync(source, target, 'dir');
    return { status: 'created', target, source };
  }
  if (stat.isSymbolicLink()) {
    const current = fs.readlinkSync(target);
    if (current === source) return { status: 'kept', target, source };
    fs.unlinkSync(target);
    fs.symlinkSync(source, target, 'dir');
    return { status: 'replaced', target, source, previous: current };
  }
  return {
    status: 'conflict',
    target,
    message: `${target} exists and is not a symlink — leaving alone. Move or remove it, then re-run \`construct install\` to wire the hooks.`,
  };
}

export async function runSetup({ rootDir = ROOT_DIR, args = [], homeDir = HOME } = {}) {
  const argSet = new Set(args);
  const isYes = argSet.has('--yes');
  const skipDocker = argSet.has('--no-docker');
  const reconfigure = argSet.has('--reconfigure');

  if (argSet.has('--help') || argSet.has('-h')) {
    printHelp();
    return;
  }

  // Reject unknown flags loudly so a typo (e.g. --reconfig) fails fast with the
  // help text instead of silently running defaults.

  const KNOWN_FLAGS = new Set(['--yes', '--no-docker', '--reconfigure', '--help', '-h']);
  const unknownFlags = args.filter((a) => a.startsWith('-') && !KNOWN_FLAGS.has(a));
  if (unknownFlags.length) {
    console.error(`Unknown flag(s): ${unknownFlags.join(', ')}`);
    printHelp();
    throw new Error(`Unknown setup flag(s): ${unknownFlags.join(', ')}`);
  }

  console.log('Construct setup');
  console.log('────────────────');

  const envPath = ensureUserConfig(homeDir);
  const opencodePath = ensureOpenCodeConfig();
  const libLink = ensureLibSymlink({ homeDir, rootDir });

  console.log(`User config: ${envPath}`);
  console.log(`OpenCode config: ${opencodePath}`);
  if (libLink.status === 'created' || libLink.status === 'replaced') {
    console.log(`Hook lib link: ${libLink.target} → ${libLink.source} (${libLink.status})`);
  } else if (libLink.status === 'kept') {
    console.log(`Hook lib link: ${libLink.target} already in place`);
  } else if (libLink.status === 'conflict') {
    console.log(`Hook lib link: ${libLink.message}`);
  }
  warnIfGlobalCommandIsUnavailable();

  const cmInstall = ensureCmInstalled({ env: process.env });
  if (cmInstall.status === 'installed') {
    console.log('Memory CLI: installed cm via Homebrew');
  } else if (cmInstall.status === 'available') {
    console.log('Memory CLI: cm available');
  } else {
    console.log(`Memory CLI: ${cmInstall.message}`);
    if (cmInstall.installCommand) console.log(`  Install with: ${cmInstall.installCommand}`);
  }

  const cassInstall = ensureCassInstalled({ env: process.env });
  if (cassInstall.status === 'installed') {
    console.log(`Session search: ${cassInstall.message}`);
  } else if (cassInstall.status === 'available') {
    console.log('Session search: cass available');
  } else {
    console.log(`Session search: ${cassInstall.message}`);
    if (cassInstall.installCommand) console.log(`  Install with: ${cassInstall.installCommand}`);
  }

  // Local Postgres — consent-driven. Interactive default-yes; --yes accepts
  // without prompting. Skipped when --no-docker, when DATABASE_URL is already
  // set (caller has an external DB), or when user declines.

  const dockerRunner = detectDockerCompose();
  const dockerAvailable = !skipDocker && Boolean(dockerRunner);
  let serviceResult = {
    status: 'skipped',
    databaseUrl: process.env.DATABASE_URL || '',
    message: skipDocker ? 'Docker service setup skipped by flag.' : 'Docker not detected — skipping local Postgres.',
  };

  if (dockerAvailable) {
    const pgConsent = await consentToInstall({
      name: 'postgres',
      isYes,
      force: reconfigure,
      alreadyConfigured: Boolean(process.env.DATABASE_URL),
      alreadyConfiguredNote: 'DATABASE_URL already set — using external database.',
      envPath,
    });
    if (pgConsent.decision) {
      writeLocalPostgresCompose(homeDir);
      serviceResult = startManagedPostgres({ homeDir, env: process.env });
      console.log(`Postgres: ${serviceResult.status === 'ok' ? 'started locally' : serviceResult.message}`);
    } else {
      console.log(`Postgres: skipped (${pgConsent.note})`);
    }
  } else if (skipDocker) {
    console.log('Postgres: skipped (--no-docker)');
  } else {
    console.log('Postgres: skipped (Docker not detected — local Postgres unavailable)');
    console.log(`  ${dockerInstallHint()}`);
  }

  const telemetryResult = process.env.CONSTRUCT_TELEMETRY_URL
    ? { status: 'configured', note: `remote export configured (${process.env.CONSTRUCT_TELEMETRY_URL})` }
    : { status: 'local', note: 'local JSONL traces in .cx/traces; remote export optional' };
  console.log(`Telemetry: ${telemetryResult.note}`);

  fs.mkdirSync(path.dirname(defaultVectorIndexPath(homeDir)), { recursive: true });

  // Pre-warm the embedding model so the first agent query doesn't stall on
  // a one-time ONNX download. Same pattern as `supabase start` pre-pulling
  // images and `playwright install` pre-fetching browsers — make the wait
  // visible during setup, not during user-facing work. Best-effort: a
  // download failure here degrades gracefully via the engine's hash fallback
  // and is non-fatal to setup.

  try {
    const warm = await warmupEmbeddingModel({ env: process.env });
    if (warm.degraded) {
      console.log(`Embeddings: degraded fallback (${warm.fallbackReason || 'model unavailable'}) — semantic search will use the hashing backend`);
    } else {
      console.log(`Embeddings: ${warm.model} ready (${warm.dimensions}d, warmed in ${warm.durationMs}ms)`);
    }
  } catch (err) {
    console.log(`Embeddings: warmup skipped (${err?.message || 'unknown error'}) — model will load on first use`);
  }

  // Cheapest provider selection — opt-out by default. When user consents,
  // evaluate all configured providers, pick the lowest-cost model per tier,
  // and write to config.env. On subsequent runs the preference is persisted
  // so the prompt is skipped.

  const { isCheapestProviderEnabled, selectCheapestForAllTiers, setCheapestProviderPreference, formatCheapestProviderMessage } =
    await import('./model-cheapest-provider.mjs');
  const cheapestAlreadyEnabled = isCheapestProviderEnabled(envPath, { env: process.env });
  if (!cheapestAlreadyEnabled) {
    const cheapestConsent = await consentToInstall({
      name: 'cheapest-provider',
      isYes,
      force: reconfigure,
      alreadyConfigured: false,
      envPath,
      defaultYes: false,
    });
    if (cheapestConsent.decision) {
      try {
        const { applyToEnv } = await import('./model-router.mjs');
        const selections = await selectCheapestForAllTiers({ env: process.env });
        const applied = {};
        for (const tier of ['reasoning', 'standard', 'fast']) {
          if (selections[tier]?.modelId) applied[tier] = selections[tier].modelId;
        }
        if (Object.keys(applied).length > 0) {
          applyToEnv(envPath, applied);
          console.log('\nCheapest providers applied:');
          for (const [tier, model] of Object.entries(applied)) {
            const label = selections[tier]?.providerLabel || '';
            console.log(`  ${tier.padEnd(11)} ${model} (${label})`);
          }
        } else {
          console.log('\nCheapest provider: no configured providers found — nothing to apply.');
        }
        setCheapestProviderPreference(envPath, true);
      } catch (err) {
        console.log(`Cheapest provider: skipped (${err?.message || 'unknown error'})`);
      }
    } else {
      console.log(`Cheapest provider: skipped (${cheapestConsent.note})`);
    }
  } else {
    console.log('Cheapest provider: already enabled — skipping prompt.');
  }

  // Ensure workspace directory with docs lanes exists
  ensureWorkspace(homeDir);

  const managedValues = await buildManagedSetupValues({
    homeDir,
    env: process.env,
    databaseUrl: serviceResult.databaseUrl,
  });
  writeEnvValues(envPath, managedValues);
  let pressureGuardAgent = null;
  let pressureGuardLoad = null;
  if (process.platform === 'darwin') {
    pressureGuardAgent = installPressureGuardLaunchAgent({
      homeDir,
      rootDir,
      intervalSeconds: Number(managedValues.CONSTRUCT_PRESSURE_GUARD_INTERVAL_SECONDS || 300),
      nodePath: process.execPath,
    });
    pressureGuardLoad = loadPressureGuardLaunchAgent({ plistPath: pressureGuardAgent.plistPath });
  }

  if (isYes) {
    console.log('\nManaged setup:');
    console.log(`  Deployment mode: ${getDeploymentMode(process.env) || DEFAULT_DEPLOYMENT_MODE} (set in construct.config.json — runtime env override available via ${DEPLOYMENT_MODE_ENV_KEY})`);
    console.log(`  Vector index: ${managedValues.CONSTRUCT_VECTOR_INDEX_PATH}`);
    console.log(`  Vector model: ${managedValues.CONSTRUCT_VECTOR_MODEL}`);
    console.log(`  Trace backend: ${managedValues.CONSTRUCT_TRACE_BACKEND}`);
    if (managedValues.CONSTRUCT_TELEMETRY_URL) console.log(`  Trace URL: ${managedValues.CONSTRUCT_TELEMETRY_URL}`);
    console.log(`  Pressure guard: every ${managedValues.CONSTRUCT_PRESSURE_GUARD_INTERVAL_SECONDS}s, swap threshold ${managedValues.CONSTRUCT_PRESSURE_GUARD_SWAP_GB} GiB`);
    if (serviceResult.status === 'ok') {
      console.log(`  Postgres: ${serviceResult.databaseUrl}`);
      console.log(`  Compose file: ${serviceResult.composePath}`);
    } else {
      console.log(`  Postgres: ${serviceResult.message}`);
    }
    if (pressureGuardAgent?.plistPath) {
      console.log(`  LaunchAgent: ${pressureGuardAgent.plistPath}`);
      console.log(`  LaunchAgent load: ${pressureGuardLoad?.loaded ? 'active' : pressureGuardLoad?.reason || 'pending manual load'}`);
    }
  }

  // Schema init runs whenever postgres is reachable — pgvector tables must exist before any
  // retrieval call. Idempotent via construct_schema_migrations hash tracking.

  if (serviceResult.status === 'ok') {
    try {
      await waitForSqlReady({ ...process.env, ...managedValues });
      const readyClient = createSqlClient({ ...process.env, ...managedValues });
      if (readyClient) {
        try {
          const { applied } = await runMigrations(readyClient);
          if (applied.length) console.log(`Postgres schema: applied ${applied.length} migration(s) — ${applied.join(', ')}`);
          else console.log('Postgres schema: up to date');
        } finally {
          await closeSqlClient(readyClient).catch(() => {});
        }
      }
    } catch (error) {
      console.log(`Postgres schema init failed: ${error?.message || 'unknown error'}`);
    }
  }

  if (isYes && serviceResult.status === 'ok') {
    const sqlClient = createSqlClient({ ...process.env, ...managedValues });
    if (sqlClient) {
      try {
        const restore = restoreConstructDb({ homeDir });
        if (restore.status === 'restored') {
          console.log(`Construct DB restored from stash: ${restore.stashPath}`);
        } else if (restore.status === 'no-stash') {
          console.log('No stash found — starting with empty construct DB.');
        } else {
          console.log(`Construct DB restore: ${restore.status}`);
        }

        // Index Construct's own package docs (rootDir, machine-scoped) into the
        // shared hybrid store. Seeding a downstream project's corpus is project
        // state and belongs to `construct init` / `construct ingest`, never to
        // machine install (ADR-0027 §3): install reads no cwd.

        const syncResult = await syncFileStateToSql(rootDir, { env: { ...process.env, ...managedValues }, project: 'construct' });
        console.log(`Hybrid storage sync: ${syncResult.status}`);
        if (syncResult.embeddingModel) console.log(`Embedding model: ${syncResult.embeddingModel}`);
      } catch (error) {
        console.log(`Hybrid storage sync failed: ${error?.message || 'unknown error'}`);
      } finally {
        await closeSqlClient(sqlClient).catch(() => {});
      }
    }
  }

  if (isYes) {
    runConstruct(['mcp', 'add', 'memory', '--auto'], { optional: true });
    runConstruct(['mcp', 'add', 'github', '--auto'], { optional: true });
  } else {
    console.log('\nManaged defaults written:');
    console.log(`  Deployment mode: ${getDeploymentMode(process.env) || DEFAULT_DEPLOYMENT_MODE} (set in construct.config.json — runtime env override available via ${DEPLOYMENT_MODE_ENV_KEY})`);
    console.log(`  Vector index: ${managedValues.CONSTRUCT_VECTOR_INDEX_PATH}`);
    console.log(`  Trace backend: ${managedValues.CONSTRUCT_TRACE_BACKEND}${managedValues.CONSTRUCT_TELEMETRY_URL ? ` (${managedValues.CONSTRUCT_TELEMETRY_URL})` : ''}`);
    console.log(`  Pressure guard: swap ${managedValues.CONSTRUCT_PRESSURE_GUARD_SWAP_GB} GiB, opencode max ${managedValues.CONSTRUCT_PRESSURE_GUARD_MAX_OPENCODE}`);
    console.log('\nFor unattended setup, including local Postgres when Docker is running:');
    console.log('  construct install --yes');
  }

  // Install is machine setup: the global front-door agent must land on every
  // user-scope surface (opencode/claude/codex/copilot) or a fresh machine fails
  // cross-surface parity. Plain sync writes global hooks + project tier but not
  // the front-door agent — `--global` is what populates it, so run both.

  runConstruct(['sync']);
  runConstruct(['sync', '--global']);
  runConstruct(['doctor']);

  // ── Summary panel ────────────────────────────────────────────────────────
  const setupTs = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  const setupLogPath = path.join(HOME, '.cx', `setup-${setupTs}.log`);
  try {
    fs.mkdirSync(path.dirname(setupLogPath), { recursive: true });
    const logLines = [
      `Construct setup completed ${new Date().toISOString()}`,
      `Config: ${getUserEnvPath(HOME)}`,
      `OpenCode: ${getCanonicalOpenCodeConfigPath(HOME)}`,
    ];
    if (managedValues?.DATABASE_URL) {
      logLines.push(`Database: ${managedValues.DATABASE_URL.replace(/:\/\/[^@]+@/, '://<credentials>@')}`);
    }
    fs.writeFileSync(setupLogPath, logLines.join('\n') + '\n');
  } catch { /* best effort */ }

  console.log('\n────────────────────────────────────');
  console.log('Setup complete.');

  // Local-service summary — surfaces running local services. Same pattern
  // as `supabase start`, which prints all local URLs + keys after spin-up.

  const hasLocalPostgres = serviceResult?.status === 'ok' && serviceResult?.databaseUrl?.includes('127.0.0.1');
  const vectorBackend = hasLocalPostgres
    ? { label: 'Postgres + pgvector', detail: `${serviceResult.databaseUrl} (384d embeddings, ${managedValues.CONSTRUCT_VECTOR_MODEL})` }
    : { label: 'JSON fallback', detail: `${managedValues.CONSTRUCT_VECTOR_INDEX_PATH} (${managedValues.CONSTRUCT_VECTOR_MODEL})` };

  console.log('\nLocal services:');
  console.log('  Traces:      local JSONL (.cx/traces)');
  if (process.env.CONSTRUCT_TELEMETRY_URL) console.log(`  Telemetry:   remote export (${process.env.CONSTRUCT_TELEMETRY_URL})`);
  else console.log('  Telemetry:   remote export not configured');
  if (hasLocalPostgres) {
    console.log(`  Postgres:    ${serviceResult.databaseUrl}`);
  } else if (process.env.DATABASE_URL) {
    console.log(`  Postgres:    external (${process.env.DATABASE_URL.replace(/:\/\/[^@]+@/, '://<credentials>@')})`);
  } else {
    console.log(`  Postgres:    not running — vector retrieval will use JSON fallback`);
  }
  console.log(`  Vector:      ${vectorBackend.label}`);
  console.log(`    ${vectorBackend.detail}`);
  console.log('  Credentials are saved to ~/.construct/config.env for later reference.');

  console.log('\nNext steps:');
  console.log('  construct provider add github     # Connect GitHub repository data');
  console.log('  construct doctor                  # Verify all systems');
  console.log('  construct evals retrieval         # Baseline retrieval quality');
  console.log(`\nSetup log: ${setupLogPath}`);
}

function ensureUserConfig(homeDir = HOME) {
  ensureUserConfigDir(homeDir);
  const envPath = getUserEnvPath(homeDir);
  if (!fs.existsSync(envPath)) writeEnvValues(envPath, {});
  return envPath;
}

/**
 * Create ~/.construct/workspace/ with the standard docs lane structure.
 * Fallback target for embed output that isn't repo-specific.
 */
export function ensureWorkspace(homeDir = HOME) {
  const wsPath = path.join(homeDir, '.construct', 'workspace');
  const docsPath = path.join(wsPath, 'docs');
  for (const lane of WORKSPACE_DOCS_LANES) {
    fs.mkdirSync(path.join(docsPath, lane), { recursive: true });
  }
  // Ensure top-level workspace files exist
  const snapshotPath = path.join(wsPath, 'snapshot.md');
  if (!fs.existsSync(snapshotPath)) fs.writeFileSync(snapshotPath, '# Snapshot\n\nNo snapshot yet.\n');
  const roadmapPath = path.join(wsPath, 'roadmap.md');
  if (!fs.existsSync(roadmapPath)) fs.writeFileSync(roadmapPath, '# Roadmap\n\nNo roadmap generated yet.\n');
  return wsPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSetup({ args: process.argv.slice(2) });
}
