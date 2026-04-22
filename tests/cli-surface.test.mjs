/**
 * tests/cli-surface.test.mjs — validates public CLI behavior against the current project cwd.
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

test('construct search uses the current working directory as project scope', () => {
  const homeDir = tempDir('construct-cli-home-');
  const projectDir = tempDir('construct-cli-project-');

  fs.mkdirSync(path.join(projectDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, '.cx'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'docs', 'architecture.md'), '# Architecture\nProject-local authoritative search target.\n');
  fs.writeFileSync(path.join(projectDir, 'docs', 'README.md'), '# Docs\n');
  fs.writeFileSync(path.join(projectDir, '.cx', 'context.json'), JSON.stringify({
    contextSummary: 'Project-local context',
    savedAt: '2026-04-19T00:00:00Z',
  }));
  fs.writeFileSync(path.join(projectDir, '.cx', 'workflow.json'), JSON.stringify({
    title: 'Project-local workflow',
    phase: 'implement',
    status: 'done',
    currentTaskKey: 'todo:1',
  }));

  const out = execFileSync(process.execPath, [BIN, 'search', 'authoritative search', '--limit=5'], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir },
  });

  const json = JSON.parse(out);
  assert.equal(json.summary.workflowTitle, 'Project-local workflow');
  assert.ok(json.results.some((entry) => entry.id === 'docs/architecture.md'));
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

test('construct help includes the update command', () => {
  const out = execFileSync(process.execPath, [BIN, '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.match(out, /update\s+Reinstall this checkout globally, then sync and verify hosts/);
});
