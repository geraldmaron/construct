/**
 * tests/cli/doctor.test.ts — CLI-surface coverage for `construct doctor`'s
 * project-tree litter reporting: a fixture tree carrying predecessor markers
 * is reported one line per marker, each pointing at `construct cleanup`; a
 * clean fixture tree adds no litter lines. Doctor's other checks (node, paths,
 * matrix, store, host) read the real environment regardless of `cwd` — that
 * is pre-existing doctor behavior this feature does not change — so these
 * tests only assert on the `litter` lines and on doctor's exit code, not on
 * the whole transcript.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { doctor } from '../../src/cli/index.ts';

function captureStdio<T>(fn: () => T): { result: T; out: string; err: string } {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = fn();
    return { result, out, err };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

function mkFixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-doctor-proj-'));
}

/**
 * Doctor's store check reads the real environment, and these tests assert on
 * doctor's exit code — so they must hand it a writable data dir, or a machine
 * whose HOME is read-only (the sterile CI job) fails the store check and the
 * exit-code assertion inherits a failure that has nothing to do with litter.
 */
function withWritableDataDir<T>(root: string, fn: () => T): T {
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, 'share');
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
  }
}

test('doctor reports each predecessor marker with the cleanup pointer', () => {
  const cwd = mkFixtureDir();
  try {
    fs.mkdirSync(path.join(cwd, '.construct', 'launcher'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.construct', 'launcher', 'run.mjs'), '// launcher shim\n');
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude', 'settings.json'),
      JSON.stringify(
        { hooks: { 'pre:session': [{ command: 'node .construct/launcher/run.mjs hook pre-session' }] } },
        null,
        2,
      ),
    );
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', ['config', 'core.hooksPath', '.beads/hooks'], { cwd });

    const { result, out } = captureStdio(() => withWritableDataDir(cwd, () => doctor(cwd)));

    const litterLines = out.split('\n').filter((line) => line.startsWith('ok   litter'));
    // .construct/launcher/ existing implies .construct/ itself exists too, so
    // that one fixture trips both project-launcher and project-state.
    assert.equal(litterLines.length, 4, `expected 4 litter lines, got:\n${out}`);
    assert.match(out, /launcher directory — run `construct cleanup --scope=project` to review/);
    assert.match(out, /settings\.json.*— run `construct cleanup --scope=project` to review/);
    assert.match(out, /core\.hooksPath.*— run `construct cleanup --scope=project` to review/);
    assert.equal(result, 0, 'litter is reported, not gated — doctor still reports healthy');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctor prints no litter lines for a clean project tree, and still exits 0', () => {
  const cwd = mkFixtureDir();
  try {
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"clean"}\n');

    const { result, out } = captureStdio(() => withWritableDataDir(cwd, () => doctor(cwd)));

    assert.ok(!out.includes(' litter '), `expected no litter lines, got:\n${out}`);
    assert.equal(result, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
