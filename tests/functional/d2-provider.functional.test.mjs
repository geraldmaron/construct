/**
 * tests/functional/d2-provider.functional.test.mjs — D2 Provider Card identity and
 * shared spawn routing across diagram CLI, publish export, and PPTX (construct-tsyfe.4.3).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  D2_PROVIDER_ID,
  queryD2ProviderCard,
  resolveD2Provider,
  spawnD2Render,
} from '../../lib/providers/d2.mjs';
import { findProviderCard, validateProviderCard } from '../../lib/providers/provider-card.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIAGRAM_SRC = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'diagram.mjs'), 'utf8');
const DIAGRAM_EXPORT_SRC = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'diagram-export.mjs'), 'utf8');
const DECK_EXPORT_SRC = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'deck-export-pptx.mjs'), 'utf8');

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeStubD2(dir, versionLine = 'd2 v0.6.5') {
  const binPath = path.join(dir, 'd2');
  const script = [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2);',
    `if (args.includes("--version")) { console.log(${JSON.stringify(versionLine)}); process.exit(0); }`,
    'process.exit(0);',
  ].join('\n');
  fs.writeFileSync(binPath, script);
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

test('registry/provider-cards.json carries a d2 binary card that validates', () => {
  const card = findProviderCard(D2_PROVIDER_ID);
  assert.ok(card, 'expected a Provider Card for d2');
  assert.equal(card.kind, 'binary');
  assert.equal(card.healthCheck.kind, 'subprocess-version');
  const result = validateProviderCard(card);
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('resolveD2Provider resolves version from a stub d2 on PATH', () => {
  const dir = tmpDir('cx-d2-provider-stub-');
  writeStubD2(dir);
  const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH || ''}`, CONSTRUCT_D2_BIN: '' };
  const resolved = resolveD2Provider(env);
  assert.ok(resolved.path);
  assert.match(resolved.version, /d2 v0\.6\.5/);
  assert.equal(resolved.degraded, false);
});

test('spawnD2Render returns card identity with the spawn result', () => {
  const dir = tmpDir('cx-d2-provider-spawn-');
  const bin = writeStubD2(dir);
  const outPath = path.join(dir, 'out.svg');
  const srcPath = path.join(dir, 'in.d2');
  fs.writeFileSync(srcPath, 'x: hi');
  const spawned = spawnD2Render({
    binary: bin,
    sourcePath: srcPath,
    outPath,
    profile: 'distribution',
    spawnSyncFn: () => {
      fs.writeFileSync(outPath, '<svg></svg>');
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(spawned.providerId, D2_PROVIDER_ID);
  assert.equal(spawned.profile, 'distribution');
  assert.deepEqual(spawned.flags.slice(0, 4), ['--sketch', '--pad', '8', '--theme']);
});

test('lib/diagram.mjs routes D2 renders through spawnD2Render', () => {
  assert.match(DIAGRAM_SRC, /spawnD2Render\(/);
  assert.match(DIAGRAM_SRC, /from '\.\/providers\/d2\.mjs'/);
});

test('lib/diagram-export.mjs sources distribution D2 defaults from the provider', () => {
  assert.match(DIAGRAM_EXPORT_SRC, /from '\.\/providers\/d2\.mjs'/);
  assert.match(DIAGRAM_EXPORT_SRC, /distributionD2Defaults/);
});

test('lib/deck-export-pptx.mjs routes diagram d2 renders through spawnD2Render', () => {
  assert.match(DECK_EXPORT_SRC, /spawnD2Render\(/);
  assert.match(DECK_EXPORT_SRC, /from '\.\/providers\/d2\.mjs'/);
  assert.doesNotMatch(DECK_EXPORT_SRC, /spawnSync\(\s*['"]d2['"]/);
});

test('queryD2ProviderCard exposes install hint text', () => {
  const identity = queryD2ProviderCard();
  assert.equal(identity.id, D2_PROVIDER_ID);
  assert.match(identity.installHint, /d2|D2|brew install/i);
});
