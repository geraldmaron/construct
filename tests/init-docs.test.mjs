/**
 * tests/init-docs.test.mjs — verifies non-destructive project and docs bootstrap.
 *
 * Covers the split between `construct init` and `construct init-docs`, making
 * sure both commands create only missing files, preserve existing repo rules,
 * and scaffold the expected docs lanes/templates.
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

test('construct init bootstraps repo state without overwriting existing AGENTS.md', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-');
  const existingAgents = '# Existing agent rules\n\nDo not overwrite me.\n';

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-init-check', description: 'Construct test repo' }, null, 2)}\n`);
  fs.writeFileSync(path.join(cwd, 'AGENTS.md'), existingAgents);

  execFileSync(process.execPath, [path.join(repoRoot, 'lib', 'init.mjs'), cwd], {
    cwd,
    stdio: 'pipe',
  });

  assert.equal(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'), existingAgents);
  assert.equal(fs.existsSync(path.join(cwd, 'plan.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'context.json')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'context.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, '.cx', '.gitkeep')), true);

  const plan = fs.readFileSync(path.join(cwd, 'plan.md'), 'utf8');
  const context = fs.readFileSync(path.join(cwd, '.cx', 'context.md'), 'utf8');

  assert.match(plan, /one writer per file/i);
  assert.match(context, /Beads/);
  assert.doesNotMatch(plan, /workflow\.json/i);
});

test('init-docs scaffolds selected doc lanes and preserves existing docs files', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = tempDir('construct-init-docs-');
  const existingDocsReadme = '# Existing docs index\n';

  fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ name: 'construct-docs-check', description: 'Construct docs repo' }, null, 2)}\n`);
  fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'docs', 'README.md'), existingDocsReadme);

  execFileSync(process.execPath, [
    path.join(repoRoot, 'lib', 'init-docs.mjs'),
    cwd,
    '--yes',
    '--docs=prds,rfcs,adr,memos,runbooks',
    '--extras=decision-notes',
  ], {
    cwd,
    stdio: 'pipe',
  });

  assert.equal(fs.readFileSync(path.join(cwd, 'docs', 'README.md'), 'utf8'), existingDocsReadme);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'architecture.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'prds', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'rfcs', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'adr', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'memos', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'runbooks', '_template.md')), true);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'decision-notes', '_template.md')), true);

  const architectureDoc = fs.readFileSync(path.join(cwd, 'docs', 'architecture.md'), 'utf8');
  const customLane = fs.readFileSync(path.join(cwd, 'docs', 'decision-notes', 'README.md'), 'utf8');

  assert.match(architectureDoc, /single writer per file/i);
  assert.match(architectureDoc, /Beads/i);
  assert.match(customLane, /custom documentation lane/i);
});

test('setup docs include hybrid backend configuration entries', () => {
  const cwd = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const envExample = fs.readFileSync(path.join(cwd, '.env.example'), 'utf8');
  assert.match(envExample, /DATABASE_URL/);
  assert.match(envExample, /CONSTRUCT_VECTOR_URL/);
  assert.match(envExample, /CONSTRUCT_VECTOR_MODEL/);
});
