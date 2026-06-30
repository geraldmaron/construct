/**
 * tests/health-check-resolve-credentials.test.mjs
 *
 * Guards construct-trxz.8: resolveCredentials({ writeConfig: true }) must persist
 * only op:// references into config.env — never a plain secret value discovered in
 * a dotenv or shell rc — and must chmod the file to 0600.
 *
 * XDG_CONFIG_HOME and the two probe vars are neutralized for the run so the tmp
 * HOME's shell rc is the only credential source and the write lands under the tmp
 * config dir, never the developer's real config.env.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveCredentials } from '../lib/health-check.mjs';

test('resolveCredentials persists only op:// references and chmods config.env to 0600', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-resolvecreds-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });

  const plainVar = 'COHERE_API_KEY';
  const refVar = 'AI21_API_KEY';
  const plainValue = 'cohere-plain-not-a-real-key-zz';
  const opRef = 'op://DevVault/AI21/credential';

  const saved = {};
  for (const v of [plainVar, refVar, 'XDG_CONFIG_HOME']) { saved[v] = process.env[v]; delete process.env[v]; }
  t.after(() => {
    for (const v of [plainVar, refVar, 'XDG_CONFIG_HOME']) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  fs.writeFileSync(
    path.join(home, '.zshrc'),
    `export ${plainVar}=${plainValue}\nexport ${refVar}=$(op read '${opRef}')\n`,
    'utf8',
  );

  const linked = await resolveCredentials({ homeDir: home, writeConfig: true });

  assert.equal(linked[plainVar], plainValue, 'plain value is still discovered for presence');
  assert.equal(linked[refVar], opRef, 'op:// reference is discovered');

  const configPath = path.join(home, '.config', 'construct', 'config.env');
  const written = fs.readFileSync(configPath, 'utf8');
  assert.ok(written.includes(`${refVar}=${opRef}`), 'op:// reference is persisted');
  assert.equal(written.includes(plainVar), false, 'plain credential key must not be persisted');
  assert.equal(written.includes(plainValue), false, 'plain value must not be persisted to disk');

  const mode = fs.statSync(configPath).mode & 0o777;
  assert.equal(mode, 0o600, `config.env mode is ${mode.toString(8)}; must be 600`);
});
