/**
 * tests/functional/config-jsonc.functional.test.mjs — JSONC config loader.
 *
 * construct.config.json is authored like tsconfig.json: strict-JSON body with
 * `//`/block comments carrying piped option hints and a tolerated trailing
 * comma. These tests prove the shared parser strips comments string-safely,
 * that the central loader reads a commented config and still fails clearly on
 * an invalid live value (deployment.mode enum), and that init's commented-stub
 * scaffold prepends idempotently without changing the parsed values.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseJsonc, stripJsonComments } from '../../lib/jsonc.mjs';
import { loadProjectConfig, scaffoldCommentedConfig, CONFIG_STUB_MARKER } from '../../lib/config/project-config.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

test('parseJsonc: strips line and block comments and a trailing comma', () => {
  const raw = `{
    // deployment tier
    "version": 1,
    /* broker mode */
    "deployment": { "mode": "team", },
  }`;
  assert.deepEqual(parseJsonc(raw), { version: 1, deployment: { mode: 'team' } });
});

test('parseJsonc: a // or /* sequence inside a string value is preserved', () => {
  const raw = '{ "alias": "a//b", "note": "/* not a comment */" }';
  assert.deepEqual(parseJsonc(raw), { alias: 'a//b', note: '/* not a comment */' });
  assert.match(stripJsonComments(raw), /a\/\/b/);
});

test('loadProjectConfig: reads a construct.config.json that carries comments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-jsonc-ok-'));
  try {
    fs.writeFileSync(path.join(dir, 'construct.config.json'), `{
      // pick a deployment tier: "solo" | "team" | "enterprise"
      "version": 1,
      "deployment": { "mode": "team" },
    }
`);
    const loaded = loadProjectConfig(dir);
    assert.equal(loaded.source, 'file');
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.config.deployment.mode, 'team');
  } finally {
    rmTmpDir(dir);
  }
});

test('loadProjectConfig: an invalid live deployment.mode fails clearly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-jsonc-bad-'));
  try {
    fs.writeFileSync(path.join(dir, 'construct.config.json'), `{
      "version": 1,
      "deployment": { "mode": "galactic" }
    }`);
    const loaded = loadProjectConfig(dir);
    assert.equal(loaded.source, 'invalid');
    assert.ok(loaded.errors.length > 0, 'invalid mode must surface an error');
    assert.ok(loaded.errors.some((e) => /mode/.test(e)), `error should name the offending field: ${loaded.errors.join('; ')}`);
  } finally {
    rmTmpDir(dir);
  }
});

test('scaffoldCommentedConfig: prepends piped-option stubs, idempotently, without changing parsed values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-jsonc-stub-'));
  try {
    const configPath = path.join(dir, 'construct.config.json');
    fs.writeFileSync(configPath, `${JSON.stringify({ version: 1, deployment: { mode: 'solo' } }, null, 2)}\n`);

    assert.equal(scaffoldCommentedConfig(configPath), true, 'first scaffold writes the header');
    const text = fs.readFileSync(configPath, 'utf8');
    assert.ok(text.includes(CONFIG_STUB_MARKER));
    assert.match(text, /"solo" \| "team" \| "enterprise"/);
    assert.match(text, /"fast" \| "standard" \| "reasoning"/);

    assert.deepEqual(parseJsonc(text), { version: 1, deployment: { mode: 'solo' } }, 'commented stubs are not live values');
    assert.equal(loadProjectConfig(dir).source, 'file', 'the commented config still loads as valid');

    assert.equal(scaffoldCommentedConfig(configPath), false, 're-scaffold is a no-op (idempotent)');
  } finally {
    rmTmpDir(dir);
  }
});
