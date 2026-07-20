/**
 * tests/functional/libreoffice-export-provider.functional.test.mjs — LibreOffice
 * legacy Provider Card identity and shared spawn routing (construct-tsyfe.6.7).
 *
 * Touches registry/provider-cards.json, lib/providers/libreoffice-export-provider.mjs,
 * lib/libreoffice-export.mjs, and lib/render-pipeline.mjs, so this lives under
 * tests/functional/ per the repo multi-component rule.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LIBREOFFICE_PROVIDER_ID,
  LIBREOFFICE_REMOVAL_CONDITION,
  queryLibreOfficeProviderCard,
  resolveLibreOfficeProvider,
  spawnLibreOfficeProvider,
} from '../../lib/providers/libreoffice-export-provider.mjs';
import { findProviderCard, validateProviderCard } from '../../lib/providers/provider-card.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const LIBREOFFICE_EXPORT_SRC = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'libreoffice-export.mjs'), 'utf8');
const RENDER_PIPELINE_SRC = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'render-pipeline.mjs'), 'utf8');

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeStubSoffice(dir, versionLine = 'LibreOffice 24.8.0.0 40(Build:0)') {
  const binPath = path.join(dir, 'soffice');
  const script = [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2);',
    `if (args.includes("--version")) { console.log(${JSON.stringify(versionLine)}); process.exit(0); }`,
    'if (args.includes("--convert-to")) process.exit(0);',
    'process.exit(0);',
  ].join('\n');
  fs.writeFileSync(binPath, script);
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

test('registry/provider-cards.json carries a legacy libreoffice binary card that validates', () => {
  const card = findProviderCard(LIBREOFFICE_PROVIDER_ID);
  assert.ok(card, 'expected a Provider Card for libreoffice');
  assert.equal(card.kind, 'binary');
  assert.equal(card.legacy, true);
  assert.equal(card.healthCheck.kind, 'subprocess-version');
  assert.match(card.removalCriteria, /Pandoc ships a native \.doc writer/);
  assert.match(card.removalCriteria, /PPTX diagram rasterization/);
  const result = validateProviderCard(card);
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('queryLibreOfficeProviderCard reports legacy true and a non-empty removal condition', () => {
  const identity = queryLibreOfficeProviderCard();
  assert.equal(identity.id, LIBREOFFICE_PROVIDER_ID);
  assert.equal(identity.legacy, true);
  assert.match(identity.removalCriteria, /Remove when Pandoc ships a native \.doc writer/);
  assert.notEqual(identity.removalCriteria.trim(), '');
  assert.equal(identity.removalCriteria, LIBREOFFICE_REMOVAL_CONDITION);
});

test('resolveLibreOfficeProvider resolves version from a stub soffice on PATH', () => {
  const dir = tmpDir('cx-lo-provider-stub-');
  writeStubSoffice(dir);
  const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH || ''}`, CONSTRUCT_LIBREOFFICE_BIN: '', SOFFICE_BIN: '' };
  const resolved = resolveLibreOfficeProvider(env);
  assert.ok(resolved.path);
  assert.equal(resolved.legacy, true);
  assert.match(resolved.version, /LibreOffice 24\.8/);
});

test('spawnLibreOfficeProvider returns card identity with the spawn result', () => {
  const dir = tmpDir('cx-lo-provider-spawn-');
  const bin = writeStubSoffice(dir);
  const { result, legacy, removalCriteria } = spawnLibreOfficeProvider(['--headless', '--norestore', '--version'], { bin });
  assert.equal(result.status, 0);
  assert.equal(legacy, true);
  assert.match(removalCriteria, /\.doc writer/);
});

test('lib/libreoffice-export.mjs routes convertViaLibreOffice through spawnLibreOfficeProvider', () => {
  assert.match(LIBREOFFICE_EXPORT_SRC, /spawnLibreOfficeProvider\(/);
  assert.match(LIBREOFFICE_EXPORT_SRC, /from '\.\/providers\/libreoffice-export-provider\.mjs'/);
});

test('lib/render-pipeline.mjs routes pptx soffice conversion through spawnLibreOfficeProvider', () => {
  assert.match(RENDER_PIPELINE_SRC, /spawnLibreOfficeProvider\(/);
  assert.match(RENDER_PIPELINE_SRC, /from '\.\/providers\/libreoffice-export-provider\.mjs'/);
  assert.doesNotMatch(
    RENDER_PIPELINE_SRC,
    /spawnSync\(toolPath\(detection, 'soffice'\), \['--headless'/,
    'direct spawnSync soffice call should be replaced by the Provider-Card-mediated wrapper',
  );
});
