/**
 * tests/init-docs.test.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('init-docs static scaffold creates expected core docs for construct-style repos', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-docs-');
  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct', description: 'Construct test repo' }, null, 2)}\n`);

  execFileSync(process.execPath, [path.join(repoRoot, 'lib', 'init-docs.mjs'), cwd, '--yes'], {
    cwd,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: '',
      OPENROUTER_API_KEY: '',
    },
    stdio: 'pipe',
  });

  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'architecture.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'runbooks', 'README.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'context.json')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'context.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'workflow.json')), true);

  const docsReadme = fs.readFileSync(path.join(cwd, 'docs', 'README.md'), 'utf8');
  const architectureDoc = fs.readFileSync(path.join(cwd, 'docs', 'architecture.md'), 'utf8');
  const contextDoc = fs.readFileSync(path.join(cwd, '.cx', 'context.md'), 'utf8');

  assert.match(docsReadme, /Required project state/);
  assert.match(docsReadme, /All LLMs working in this repo/);
  assert.match(architectureDoc, /Required project state/);
  assert.match(contextDoc, /Required project state/);
});

test('setup docs include hybrid backend configuration entries', () => {
  const cwd = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const envExample = fs.readFileSync(path.join(cwd, '.env.example'), 'utf8');
  assert.match(envExample, /DATABASE_URL/);
  assert.match(envExample, /CONSTRUCT_VECTOR_URL/);
  assert.match(envExample, /CONSTRUCT_VECTOR_MODEL/);
});
