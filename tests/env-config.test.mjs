/**
 * tests/env-config.test.mjs — Unit tests for lib/env-config.mjs.
 *
 * Covers env file parsing, persistence helpers, and synthesized database
 * connection resolution from the DB_* runtime variables.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConstructEnv, resolveDatabaseUrl, getUserEnvPath } from '../lib/env-config.mjs';

import { tempDir } from './helpers.mjs';

test('resolveDatabaseUrl preserves an explicit DATABASE_URL', () => {
  const url = resolveDatabaseUrl({
    DATABASE_URL: 'postgresql://user:pass@db.example:5432/construct',
    DB_HOST: 'ignored.example',
  });

  assert.equal(url, 'postgresql://user:pass@db.example:5432/construct');
});

test('resolveDatabaseUrl composes discrete DB_* variables when DATABASE_URL is absent', () => {
  const url = resolveDatabaseUrl({
    DB_HOST: 'db.internal',
    DB_PORT: '5432',
    DB_NAME: 'construct',
    DB_USER: 'construct',
    DB_PASSWORD: 'secret',
  });

  assert.equal(url, 'postgresql://construct:secret@db.internal:5432/construct');
});

test('loadConstructEnv exposes composed DATABASE_URL for downstream callers', () => {
  const homeDir = tempDir('construct-env-config-');
  const env = loadConstructEnv({
    homeDir,
    env: {
      DB_HOST: 'db.internal',
      DB_NAME: 'construct',
      DB_USER: 'construct',
      DB_PASSWORD: 'secret',
    },
    warn: false,
  });

  assert.equal(env.DATABASE_URL, 'postgresql://construct:secret@db.internal:5432/construct');
});

test('loadConstructEnv keeps op run injected credentials over config.env op refs', () => {
  const homeDir = tempDir('construct-env-op-run-');
  const configPath = getUserEnvPath(homeDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    'ANTHROPIC_API_KEY=op://Dev/Anthropic/credential\nOPENROUTER_API_KEY=op://Dev/OpenRouter/credential\n',
    'utf8',
  );

  const env = loadConstructEnv({
    homeDir,
    env: {
      ANTHROPIC_API_KEY: 'sk-ant-resolved-once',
      OPENROUTER_API_KEY: 'or-resolved-once',
    },
    warn: false,
  });

  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-resolved-once');
  assert.equal(env.OPENROUTER_API_KEY, 'or-resolved-once');
});

test('loadConstructEnv still prefers config.env over stale shell op refs', () => {
  const homeDir = tempDir('construct-env-op-ref-');
  const configPath = getUserEnvPath(homeDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    'OPENAI_API_KEY=op://Dev/OpenAI/from-config\n',
    'utf8',
  );

  const env = loadConstructEnv({
    homeDir,
    env: {
      OPENAI_API_KEY: 'op://Dev/OpenAI/from-shell',
    },
    warn: false,
  });

  assert.equal(env.OPENAI_API_KEY, 'op://Dev/OpenAI/from-config');
});

function seedEnvFiles(prefix, { user = {}, project = {} } = {}) {
  const homeDir = tempDir(prefix);
  const rootDir = tempDir(`${prefix}root-`);
  const userPath = getUserEnvPath(homeDir);
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.writeFileSync(userPath, Object.entries(user).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(rootDir, '.env'), Object.entries(project).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 'utf8');
  return { homeDir, rootDir };
}

test('project .env wins over user config.env for the same key', () => {
  const { homeDir, rootDir } = seedEnvFiles('construct-env-precedence-', {
    user: { SHARED: 'user_value', ONLY_USER: 'u' },
    project: { SHARED: 'project_value', ONLY_PROJECT: 'p' },
  });

  const env = loadConstructEnv({ rootDir, homeDir, env: {}, warn: false });

  assert.equal(env.SHARED, 'project_value');
  assert.equal(env.ONLY_USER, 'u');
  assert.equal(env.ONLY_PROJECT, 'p');
});

test('loadConstructEnv warns on every key shadowed between project .env and user config.env', () => {
  const { homeDir, rootDir } = seedEnvFiles('construct-env-shadow-', {
    user: { CUSTOM_SETTING: 'user', AGREE: 'same' },
    project: { CUSTOM_SETTING: 'project', AGREE: 'same' },
  });

  let warned = '';
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { warned += chunk; return true; };
  try {
    loadConstructEnv({ rootDir, homeDir, env: {}, warn: true });
  } finally {
    process.stderr.write = original;
  }

  assert.match(warned, /CUSTOM_SETTING is set to different values in project \.env/);
  assert.equal(/AGREE is set to different values/.test(warned), false);
});

function captureWarnings(run) {
  let warned = '';
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { warned += chunk; return true; };
  try {
    run();
  } finally {
    process.stderr.write = original;
  }
  return warned;
}

test('shadow warnings name the key but never echo any secret value bytes', () => {
  const userSecret = 'sk-USERVALUE-must-not-appear';
  const projectSecret = 'sk-PROJVALUE-must-not-appear';
  const { homeDir, rootDir } = seedEnvFiles('construct-env-shadow-noleak-', {
    user: { OPENROUTER_API_KEY: userSecret },
    project: { OPENROUTER_API_KEY: projectSecret },
  });

  const warned = captureWarnings(() => loadConstructEnv({ rootDir, homeDir, env: {}, warn: true }));

  assert.match(warned, /OPENROUTER_API_KEY/);
  assert.equal(warned.includes('USERVALUE'), false);
  assert.equal(warned.includes('PROJVALUE'), false);
  assert.equal(warned.includes(userSecret.slice(0, 6)), false);
  assert.equal(warned.includes(projectSecret.slice(0, 6)), false);
});

test('process.env shadow warning never echoes the shell or file secret value', () => {
  const shellSecret = 'sk-SHELLVALUE-must-not-appear';
  const fileSecret = 'sk-FILEVALUE-must-not-appear';
  const { homeDir, rootDir } = seedEnvFiles('construct-env-shadow-proc-', {
    project: { ANTHROPIC_API_KEY: fileSecret },
  });

  const warned = captureWarnings(() => loadConstructEnv({
    rootDir, homeDir, env: { ANTHROPIC_API_KEY: shellSecret }, warn: true,
  }));

  assert.match(warned, /process\.env\.ANTHROPIC_API_KEY/);
  assert.equal(warned.includes('SHELLVALUE'), false);
  assert.equal(warned.includes('FILEVALUE'), false);
});

test('loadConstructEnv does not read a legacy ~/.construct/config.env', () => {
  const homeDir = tempDir('construct-env-legacy-');
  const legacyPath = path.join(homeDir, '.construct', 'config.env');
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(legacyPath, 'LEGACY_ONLY_KEY=should_not_load\n', 'utf8');

  const env = loadConstructEnv({ homeDir, env: {}, warn: false });

  assert.equal(env.LEGACY_ONLY_KEY, undefined);
});
