#!/usr/bin/env node
/**
 * lib/setup.mjs — Interactive first-run setup wizard for Construct.
 *
 * Guides users through provider selection, API key entry, and model tier
 * assignment. Writes the resulting config to ~/.cx/env and optionally to
 * project-level .env. Invoked by `construct setup` and on first init.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ensureUserConfigDir, getUserEnvPath, writeEnvValues } from './env-config.mjs';
import { getCanonicalOpenCodeConfigPath, readOpenCodeConfig, writeOpenCodeConfig } from './opencode-config.mjs';
import { syncFileStateToSql } from './storage/sync.mjs';
import { createSqlClient, closeSqlClient } from './storage/backend.mjs';
import { EMBEDDING_MODEL } from './storage/embeddings.mjs';
import { restoreConstructDb } from './storage/postgres-backup.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const HOME = os.homedir();
const LOCAL_POSTGRES_PORT = '54329';
const LOCAL_POSTGRES_USER = 'construct';
const LOCAL_POSTGRES_PASSWORD = 'construct';
const LOCAL_POSTGRES_DB = 'construct';
const LOCAL_DATABASE_URL = `postgresql://${LOCAL_POSTGRES_USER}:${LOCAL_POSTGRES_PASSWORD}@127.0.0.1:${LOCAL_POSTGRES_PORT}/${LOCAL_POSTGRES_DB}`;

function printHelp() {
  console.log(`Construct setup

Usage:
  construct setup [--yes] [--no-docker]

What it does:
  - creates ~/.construct/config.env
  - ensures OpenCode config exists
  - configures managed defaults for local vector retrieval
  - starts local Postgres with Docker when available
  - checks required runtime tools and installs cm and cass when available
  - wires Memory, GitHub, and Langfuse configuration
  - runs construct sync (which also regenerates AUTO docs regions)
  - runs construct doctor
  - detects the project tech stack and writes .cx/project-profile.json

Use --yes to run without prompts and accept detected environment defaults.`);
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

export function buildManagedSetupValues({ homeDir = HOME, env = process.env, databaseUrl = '' } = {}) {
  const values = {
    CONSTRUCT_TRACE_BACKEND: env.CONSTRUCT_TRACE_BACKEND || 'langfuse',
    LANGFUSE_BASEURL: env.LANGFUSE_BASEURL || 'https://cloud.langfuse.com',
    CONSTRUCT_VECTOR_INDEX_PATH: env.CONSTRUCT_VECTOR_INDEX_PATH || defaultVectorIndexPath(homeDir),
    CONSTRUCT_VECTOR_MODEL: env.CONSTRUCT_VECTOR_MODEL || EMBEDDING_MODEL,
  };

  const resolvedDatabaseUrl = databaseUrl || env.DATABASE_URL || '';
  if (resolvedDatabaseUrl) values.DATABASE_URL = resolvedDatabaseUrl;
  if (env.CONSTRUCT_VECTOR_URL) values.CONSTRUCT_VECTOR_URL = env.CONSTRUCT_VECTOR_URL;
  if (env.LANGFUSE_PUBLIC_KEY) values.LANGFUSE_PUBLIC_KEY = env.LANGFUSE_PUBLIC_KEY;
  if (env.LANGFUSE_SECRET_KEY) values.LANGFUSE_SECRET_KEY = env.LANGFUSE_SECRET_KEY;
  if (env.LANGFUSE_PROJECT_ID) values.LANGFUSE_PROJECT_ID = env.LANGFUSE_PROJECT_ID;
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

// 0.3.0 ships a frankensqlite FTS-rebuild loop that OOMs on large corpora and never converges
// (upstream issues #168, #186, #110, #155 — fixed in 0.4.0). Below this, we fail closed.
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

export async function runSetup({ rootDir = ROOT_DIR, args = [], homeDir = HOME } = {}) {
  const argSet = new Set(args);
  const isYes = argSet.has('--yes');
  const skipDocker = argSet.has('--no-docker');

  if (argSet.has('--help') || argSet.has('-h')) {
    printHelp();
    return;
  }

  console.log('Construct setup');
  console.log('────────────────');

  const envPath = ensureUserConfig(homeDir);
  const opencodePath = ensureOpenCodeConfig();

  console.log(`User config: ${envPath}`);
  console.log(`OpenCode config: ${opencodePath}`);
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

  // Always write the compose file when Docker is available so `construct up` can start postgres.
  // This is safe to run even if DATABASE_URL is already configured (external DB users).
  if (isYes && !skipDocker) {
    writeLocalPostgresCompose(homeDir);
  }

  const serviceResult = isYes && !skipDocker && !process.env.DATABASE_URL
    ? startManagedPostgres({ homeDir, env: process.env })
    : { status: 'skipped', databaseUrl: process.env.DATABASE_URL || '', message: skipDocker ? 'Docker service setup skipped by flag.' : 'Using existing DATABASE_URL if configured.' };

  fs.mkdirSync(path.dirname(defaultVectorIndexPath(homeDir)), { recursive: true });
  const managedValues = buildManagedSetupValues({
    homeDir,
    env: process.env,
    databaseUrl: serviceResult.databaseUrl,
  });
  writeEnvValues(envPath, managedValues);

  if (isYes) {
    console.log('\nManaged setup:');
    console.log(`  Vector index: ${managedValues.CONSTRUCT_VECTOR_INDEX_PATH}`);
    console.log(`  Vector model: ${managedValues.CONSTRUCT_VECTOR_MODEL}`);
    console.log(`  Trace backend: ${managedValues.CONSTRUCT_TRACE_BACKEND}`);
    console.log(`  Langfuse URL: ${managedValues.LANGFUSE_BASEURL}`);
    if (serviceResult.status === 'ok') {
      console.log(`  Postgres: ${serviceResult.databaseUrl}`);
      console.log(`  Compose file: ${serviceResult.composePath}`);
    } else {
      console.log(`  Postgres: ${serviceResult.message}`);
    }

    const sqlClient = createSqlClient({ ...process.env, ...managedValues });
    if (sqlClient) {
      let readyClient = null;
      let sqlClientClosed = false;
      try {
        if (serviceResult.status === 'ok') {
          await closeSqlClient(sqlClient);
          sqlClientClosed = true;
          await waitForSqlReady({ ...process.env, ...managedValues });
        }
        readyClient = createSqlClient({ ...process.env, ...managedValues });
        const migration = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../db/migrations/001_init.sql', import.meta.url), 'utf8'));
        await readyClient.unsafe(migration);
        console.log('\nPostgres schema initialized.');

        // Restore data from the most recent stash (if any) before syncing.
        if (serviceResult.status === 'ok') {
          const restore = restoreConstructDb({ homeDir });
          if (restore.status === 'restored') {
            console.log(`Construct DB restored from stash: ${restore.stashPath}`);
          } else if (restore.status === 'no-stash') {
            console.log('No stash found — starting with empty construct DB.');
          } else if (restore.status !== 'no-stash') {
            console.log(`Construct DB restore: ${restore.status}`);
          }
        }

        const syncResult = await syncFileStateToSql(rootDir, { env: { ...process.env, ...managedValues }, project: 'construct' });
        console.log(`Hybrid storage sync: ${syncResult.status}`);
        if (syncResult.embeddingModel) console.log(`Embedding model: ${syncResult.embeddingModel}`);
      } catch (error) {
        console.log(`Hybrid storage init failed: ${error?.message || 'unknown error'}`);
      } finally {
        await closeSqlClient(readyClient).catch(() => {});
        if (!sqlClientClosed) await closeSqlClient(sqlClient);
      }
    }
  }

  if (isYes) {
    runConstruct(['mcp', 'add', 'memory', '--auto'], { optional: true });
    runConstruct(['mcp', 'add', 'github', '--auto'], { optional: true });
    if (!managedValues.LANGFUSE_PUBLIC_KEY || !managedValues.LANGFUSE_SECRET_KEY) {
      console.log('\nLangfuse is prewired but needs account credentials:');
      console.log('  Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in ~/.construct/config.env');
      console.log('  Set these in ~/.construct/config.env or run: cd langfuse && docker compose up -d');
    }

  } else {
    console.log('\nManaged defaults written:');
    console.log(`  Vector index: ${managedValues.CONSTRUCT_VECTOR_INDEX_PATH}`);
    console.log(`  Trace backend: ${managedValues.CONSTRUCT_TRACE_BACKEND} (${managedValues.LANGFUSE_BASEURL})`);
    console.log('\nFor unattended setup, including local Postgres when Docker is running:');
    console.log('  construct setup --yes');
  }

  runConstruct(['sync']);
  runConstruct(['doctor']);

  // Profile the CWD so per-host skill filtering layers downstream have
  // a cached, host-agnostic signal to work from. Non-fatal on failure.
  try {
    const { detectProjectProfile, writeProfile } = await import('./project-profile.mjs');
    const profile = detectProjectProfile(process.cwd());
    if (profile.tags.length > 0) {
      const profilePath = writeProfile(profile, process.cwd());
      console.log(`\nProject profile: ${profile.tags.join(', ')}`);
      console.log(`  Saved to ${profilePath}`);
      console.log(`  Run \`construct skills scope\` to see which installed skills apply to this project.`);
    }
  } catch { /* best effort */ }
}

function ensureUserConfig(homeDir = HOME) {
  ensureUserConfigDir(homeDir);
  const envPath = getUserEnvPath(homeDir);
  if (!fs.existsSync(envPath)) writeEnvValues(envPath, {});
  return envPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSetup({ args: process.argv.slice(2) });
}
