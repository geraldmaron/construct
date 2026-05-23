/**
 * tests/functional/a2-research-persistence.functional.test.mjs — A2 end-to-end.
 *
 * Verifies the full research persistence path: CLI args parse, schema validates,
 * frontmatter stamps the active profile, the file lands at the expected path,
 * and the bytes are countable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

test('A2 end-to-end: construct knowledge add writes a frontmatter-stamped research finding', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-functional-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  const body = [
    'FINDINGS',
    '- npm CLI 11.5.1 or later is required for OIDC Trusted Publishers',
    '- Node 24 ships with npm 11',
    '',
    'INFERENCES',
    '- node-version: 22 with npm 10 will fail the OIDC handshake',
    '',
    'GAPS',
    '- None.',
    '',
    'RECOMMENDATION',
    '- Use Node 24 in the publish job',
  ].join('\n');

  const result = spawnSync('node', [BIN, 'knowledge', 'add',
    '--source=research',
    '--slug=npm-oidc-requirements',
    '--topic=npm OIDC Trusted Publishers',
    '--confidence=confirmed',
    '--source-url=https://docs.npmjs.com/trusted-publishers',
  ], { cwd, input: body, encoding: 'utf8', timeout: 15_000 });

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.match(result.stdout, /wrote .* bytes/);

  const outPath = path.join(cwd, '.cx', 'knowledge', 'external', 'research', 'npm-oidc-requirements.md');
  assert.ok(fs.existsSync(outPath), 'research file not written at expected path');

  const content = fs.readFileSync(outPath, 'utf8');
  assert.match(content, /^---/);
  assert.match(content, /kind: research-finding/);
  assert.match(content, /confidence: confirmed/);
  assert.match(content, /npm CLI 11\.5\.1/);
  assert.match(content, /profile: rnd/);
  assert.match(content, /expiresAt: \d{4}-\d{2}-\d{2}/);

  fs.rmSync(cwd, { recursive: true, force: true });
});

test('A2 end-to-end: confidence=confirmed without --source-url is rejected', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-functional-noSources-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  const result = spawnSync('node', [BIN, 'knowledge', 'add',
    '--source=research',
    '--slug=missing-source',
    '--topic=Something',
    '--confidence=confirmed',
  ], { cwd, input: 'body content here for the test', encoding: 'utf8', timeout: 10_000 });

  assert.notEqual(result.status, 0, 'expected non-zero exit for missing sources');
  assert.match(result.stderr + result.stdout, /confirmed requires at least one source/);

  fs.rmSync(cwd, { recursive: true, force: true });
});
