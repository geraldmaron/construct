/**
 * tests/providers/dotenv-parity.test.mjs — construct-192h.10: dotenv-file value
 * parity between lib/env-config.mjs's parseEnvFile and lib/providers/secret-resolver.mjs's
 * file tier.
 *
 * Both readers now share parseEnvContent (env-config.mjs), so a table of dotenv
 * lines — plain, paired quotes (single and double), an unpaired quote, and an
 * export-prefixed line — must resolve to byte-identical values (or the same
 * absence) from both call paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnvFile } from '../../lib/env-config.mjs';
import { resolveSecret, __clearSecretCache } from '../../lib/providers/secret-resolver.mjs';

function withDotenvFixture(lines, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-dotenv-parity-'));
  const file = path.join(home, '.env');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  __clearSecretCache();
  try {
    return fn({ home, file });
  } finally {
    process.env.HOME = originalHome;
    __clearSecretCache();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const CASES = [
  { name: 'no quotes', line: 'PLAIN_VAR=hello', key: 'PLAIN_VAR', expected: 'hello' },
  { name: 'paired double quotes', line: 'DOUBLE_VAR="hello"', key: 'DOUBLE_VAR', expected: 'hello' },
  { name: 'paired single quotes', line: "SINGLE_VAR='hello'", key: 'SINGLE_VAR', expected: 'hello' },
  { name: 'unpaired quote', line: 'UNPAIRED_VAR="abc', key: 'UNPAIRED_VAR', expected: 'abc' },
];

for (const { name, line, key, expected } of CASES) {
  test(`resolver file tier and parseEnvFile agree on ${name}`, () => {
    withDotenvFixture([line], ({ home, file }) => {
      const opRead = () => { throw new Error('op should not be called for a plain dotenv value'); };
      const viaResolver = resolveSecret(key, { env: {}, cwd: home, opRead });
      const viaParseEnvFile = parseEnvFile(file)[key];
      assert.equal(viaResolver, expected);
      assert.equal(viaParseEnvFile, expected);
      assert.equal(viaResolver, viaParseEnvFile);
    });
  });
}

test('export-prefixed dotenv line is missed identically by both readers', () => {
  withDotenvFixture(['export EXPORT_VAR=hello'], ({ home, file }) => {
    const viaResolver = resolveSecret('EXPORT_VAR', { env: {}, cwd: home });
    const viaParseEnvFile = parseEnvFile(file).EXPORT_VAR;
    assert.equal(viaResolver, null);
    assert.equal(viaParseEnvFile, undefined);
  });
});
