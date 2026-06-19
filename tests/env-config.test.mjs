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

import { loadConstructEnv, resolveDatabaseUrl } from '../lib/env-config.mjs';

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
  const configPath = path.join(homeDir, '.construct', 'config.env');
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
  const configPath = path.join(homeDir, '.construct', 'config.env');
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
