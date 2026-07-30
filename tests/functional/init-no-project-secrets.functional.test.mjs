/**
 * tests/functional/init-no-project-secrets.functional.test.mjs
 *
 * Construct init must not write user-scope credentials into the
 * project tree. Secrets belong under XDG user config, not the scaffolded repo.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

const SECRET_PATTERNS = [
  /API_KEY\s*=\s*\S+/,
  /sk-ant-[a-zA-Z0-9_-]+/,
  /sk-[a-zA-Z0-9]{20,}/,
  /op:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+/,
  /BEGIN (RSA |OPENSSH )?PRIVATE KEY/,
];

function walkFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, files);
    else files.push(full);
  }
  return files;
}

function initProject(home) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-no-secrets-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'secrets@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Secrets Test'], { cwd: dir });
  const result = spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', '--no-start'],
    {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        HOME: home,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
      },
    },
  );
  return { dir, result };
}

test('construct init does not write credential material into the project tree', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'init-secrets-home-'));
  t.after(() => {
    try { rmTmpDir(home); } catch {}
  });

  const { dir, result } = initProject(home);
  t.after(() => {
    try { rmTmpDir(dir); } catch {}
  });

  assert.equal(result.status, 0, `init failed: ${result.stderr}`);
  assert.equal(fs.existsSync(path.join(dir, 'config.env')), false, 'project must not get config.env');
  assert.equal(fs.existsSync(path.join(dir, '.env')), false, 'project must not get .env from init');

  const violations = [];
  for (const file of walkFiles(dir)) {
    if (file.endsWith('.png') || file.endsWith('.jpg')) continue;
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) violations.push(`${path.relative(dir, file)} matches ${pattern}`);
    }
  }
  assert.deepEqual(violations, [], `secret-like content in project tree: ${violations.join('; ')}`);
});
