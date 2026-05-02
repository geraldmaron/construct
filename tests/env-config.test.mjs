import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConstructEnv, resolveDatabaseUrl } from '../lib/env-config.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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
