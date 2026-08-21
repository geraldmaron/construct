/**
 * tests/cli/doctor.test.ts — CLI-surface coverage for three of `construct
 * doctor`'s reported-not-gated checks: project-tree litter (a fixture tree
 * carrying predecessor markers is reported one line per marker, each pointing
 * at `construct cleanup`), skill pack version skew, and settled deliverables
 * stuck at draft past the staleness threshold. Doctor's other checks (node,
 * paths, matrix, host) read the real environment regardless of `cwd` — that
 * is pre-existing doctor behavior this feature does not change — so these
 * tests only assert on the lines each check owns and on doctor's exit code,
 * not on the whole transcript.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { doctor } from '../../src/cli/index.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { claimTask, completeTask, enqueueTask } from '../../src/kernel/store/tasks.ts';

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

/** The version `packageVersion()` reads, so a fixture can pick a value guaranteed to differ. */
function installedVersion(): string {
  const raw = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

function writeGeneratedSkill(dir: string, name: string, version: string): void {
  const folder = path.join(dir, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'SKILL.md'),
    ['---', 'name: ' + name, 'description: a fixture skill', 'metadata:', '  generator: construct', `  version: '${version}'`, '---', '', 'body', ''].join('\n'),
  );
}

test('doctor names a skill pack stamped by a different construct version', () => {
  const cwd = mkFixtureDir();
  try {
    const stale = `${installedVersion()}-fixture-stale`;
    writeGeneratedSkill(path.join(cwd, '.claude', 'skills'), 'construct-example', stale);

    const { result, out } = captureStdio(() => withWritableDataDir(cwd, () => doctor(cwd)));

    const skillsLines = out.split('\n').filter((line) => line.startsWith('ok   skills'));
    assert.equal(skillsLines.length, 1, `expected 1 skills line, got:\n${out}`);
    assert.match(out, new RegExp(`generated by construct ${stale}, installed construct is ${installedVersion()} — regenerate with construct skills`));
    assert.equal(result, 0, 'skew is reported, not gated');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctor is silent when the skill pack matches the installed version', () => {
  const cwd = mkFixtureDir();
  try {
    writeGeneratedSkill(path.join(cwd, '.claude', 'skills'), 'construct-example', installedVersion());

    const { result, out } = captureStdio(() => withWritableDataDir(cwd, () => doctor(cwd)));

    assert.ok(!out.includes(' skills '), `expected no skills lines, got:\n${out}`);
    assert.equal(result, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctor is silent when no skill pack is present', () => {
  const cwd = mkFixtureDir();
  try {
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"no-pack"}\n');

    const { result, out } = captureStdio(() => withWritableDataDir(cwd, () => doctor(cwd)));

    assert.ok(!out.includes(' skills '), `expected no skills lines, got:\n${out}`);
    assert.equal(result, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

/**
 * The store path `doctor` resolves once XDG_DATA_HOME is redirected under
 * `root` — matching kernel/paths.ts's own join so a store written here is the
 * one `resolvePaths()` inside `doctor()` will find.
 */
function storePathUnder(root: string): string {
  return path.join(root, 'share', 'construct', 'construct.db');
}

/** A task settled `settledAt` ago with no verdict — still `draft` by construction. */
function seedSettledDraft(root: string, opts: { id: string; run: string; settledAt: string }): void {
  const store = openStore(storePathUnder(root));
  try {
    enqueueTask(store, {
      id: opts.id,
      run: opts.run,
      role: 'writer',
      brief: { challenges: [] },
      at: opts.settledAt,
    });
    const leased = claimTask(store, {
      owner: 'test',
      leaseUntil: '2099-01-01T00:00:00.000Z',
      now: opts.settledAt,
      run: opts.run,
    });
    assert.ok(leased, 'expected to claim the task it just enqueued');
    completeTask(store, {
      id: opts.id,
      owner: 'test',
      token: leased.token,
      result: { text: 'a deliverable' },
      spend: 0,
      spendReported: false,
      at: opts.settledAt,
    });
  } finally {
    store.close();
  }
}

test('doctor names a settled deliverable stuck at draft past the threshold', () => {
  const cwd = mkFixtureDir();
  try {
    const settledAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    seedSettledDraft(cwd, { id: 't-fixture-stale', run: 'run-fixture', settledAt });

    const { result, out } = captureStdio(() => withWritableDataDir(cwd, () => doctor(cwd)));

    const staleLines = out.split('\n').filter((line) => line.startsWith('ok   stale-draft'));
    assert.equal(staleLines.length, 1, `expected 1 stale-draft line, got:\n${out}`);
    assert.match(out, /1 settled deliverable\(s\) still draft with no recorded verdict/);
    assert.match(out, /3-day threshold/, 'the threshold is named in the check\'s own output');
    assert.match(out, /oldest: run run-fixture task t-fixture-stale/);
    assert.equal(result, 0, 'a stale draft is reported, not gated');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctor is silent about stale drafts when none have settled past the threshold', () => {
  const cwd = mkFixtureDir();
  try {
    // Settled a moment ago, well inside the threshold — present in the store,
    // still draft, but not yet worth naming.
    seedSettledDraft(cwd, { id: 't-fresh', run: 'run-fresh', settledAt: new Date().toISOString() });

    const { result, out } = captureStdio(() => withWritableDataDir(cwd, () => doctor(cwd)));

    assert.ok(!out.includes(' stale-draft '), `expected no stale-draft lines, got:\n${out}`);
    assert.equal(result, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('doctor is silent about stale drafts when the store does not exist yet', () => {
  const cwd = mkFixtureDir();
  try {
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"no-store-yet"}\n');
    assert.ok(!fs.existsSync(storePathUnder(cwd)), 'sanity: no store has been created for this fixture');

    const { result, out } = captureStdio(() => withWritableDataDir(cwd, () => doctor(cwd)));

    assert.ok(!out.includes(' stale-draft '), `expected no stale-draft lines, got:\n${out}`);
    assert.ok(!fs.existsSync(storePathUnder(cwd)), 'doctor must not create a database merely by being asked a question');
    assert.equal(result, 0);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
