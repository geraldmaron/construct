/**
 * tests/cli-query.test.mjs — verifies query command argument parsing.
 *
 * Runs the public CLI to ensure research/docs flags are not folded into the
 * query string passed to distill.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'bin', 'construct');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('construct research excludes flags from query text', () => {
  const root = tempDir('construct-query-');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'tokens.md'), '# Tokens\nToken efficiency uses distill.\n');

  const out = execFileSync(process.execPath, [BIN, 'research', 'token efficiency', '--dir=docs', '--depth=2'], {
    cwd: root,
    encoding: 'utf8',
  });
  const json = JSON.parse(out);

  assert.equal(json.query, 'token efficiency');
  assert.equal(json.format, 'extract');
});

test('construct docs preserves markdown filtering and excludes flags from query text', () => {
  const root = tempDir('construct-docs-query-');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', 'langfuse.md'), '# Langfuse\nLangfuse traces record quality.\n');
  fs.writeFileSync(path.join(root, 'docs', 'langfuse.js'), 'const langfuse = true;\n');

  const out = execFileSync(process.execPath, [BIN, 'docs', 'langfuse traces', '--dir=docs', '--depth=2'], {
    cwd: root,
    encoding: 'utf8',
  });
  const json = JSON.parse(out);

  assert.equal(json.query, 'langfuse traces');
  assert.equal(json.files.length, 1);
  assert.equal(json.files[0].file, 'langfuse.md');
});

test('construct evals exposes Langfuse evaluator catalog', () => {
  const out = execFileSync(process.execPath, [BIN, 'evals', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  const json = JSON.parse(out);
  assert.ok(typeof json.backendUrl === 'string');
  assert.ok(typeof json.configured === 'boolean');
});
