/**
 * tests/functional/reconcile-tasks.functional.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(REPO_ROOT, 'lib');

async function withSandbox(fn) {
  const home = mkdtempSync(join(tmpdir(), 'cx-reconcile-home-'));
  const project = mkdtempSync(join(tmpdir(), 'cx-reconcile-project-'));
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  process.env.HOME = home;
  process.chdir(project);
  try {
    await fn({ home, project });
  } finally {
    process.env.HOME = originalHome;
    process.chdir(originalCwd);
    rmTmpDir(home);
    rmTmpDir(project);
  }
}

async function taskModule(name) {
  const mod = await import(`${LIB}/reconcile/${name}?ts=${Date.now()}`);
  return mod.default;
}

test('reconcile/gitignore-coverage: ensures .construct/ is ignored', async () => {
  await withSandbox(async ({ project }) => {
    mkdirSync(join(project, '.construct'), { recursive: true });
    const gitignore = join(project, '.gitignore');
    writeFileSync(gitignore, 'node_modules\n');
    
    const task = await taskModule('gitignore-coverage.mjs');
    const before = await task.detect();
    assert.equal(before.needsRepair, true);

    await task.apply();
    assert.match(readFileSync(gitignore, 'utf8'), /\.construct\//);
  });
});
