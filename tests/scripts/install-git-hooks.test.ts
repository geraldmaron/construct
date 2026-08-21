/**
 * tests/scripts/install-git-hooks.test.ts — the pre-commit hook the installer
 * writes, exercised against a real scratch repository rather than a mock,
 * because what is under test is what git actually commits.
 *
 * The beads section is stubbed by a block that does exactly the one thing this
 * repository cares about: it stages the tracker export unconditionally. That is
 * the behavior the keeper section exists to undo, and stubbing it keeps the test
 * off a real tracker database while still exercising the real ordering, since
 * the installer preserves whatever it finds and appends the keeper after it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const BEADS_STUB = `# --- BEGIN BEADS INTEGRATION v1.0.3 ---
# This section is managed by beads. Do not remove these markers.
printf 'exported\\n' >> .beads/issues.jsonl
git add .beads/issues.jsonl
# --- END BEADS INTEGRATION v1.0.3 ---
`;

interface Scratch {
  readonly root: string;
  git(...args: string[]): string;
  cleanup(): void;
}

function scratch(): Scratch {
  const root = mkdtempSync(join(tmpdir(), 'construct-hooks-'));
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');

  mkdirSync(join(root, 'scripts', 'hooks'), { recursive: true });
  mkdirSync(join(root, '.beads'), { recursive: true });
  copyFileSync(
    join(REPO, 'scripts', 'install-git-hooks.sh'),
    join(root, 'scripts', 'install-git-hooks.sh'),
  );
  // The gate's own checks are not what this test is about, and running the real
  // ones would drag the whole repository in. They are replaced by scripts that
  // pass, so the only behavior left to observe is the staging.
  for (const name of ['secret-scan.mjs', 'repo-gate.mjs']) {
    writeFileSync(join(root, 'scripts', 'hooks', name), 'process.exit(0);\n');
  }
  writeFileSync(join(root, '.beads', 'issues.jsonl'), 'first\n');
  writeFileSync(join(root, 'source.txt'), 'first\n');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');

  // Whatever already sits in the hook is preserved by the installer, which is
  // how the real beads section survives; the stub arrives the same way.
  writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), `#!/usr/bin/env bash\n${BEADS_STUB}`, {
    mode: 0o755,
  });
  execFileSync('bash', [join(root, 'scripts', 'install-git-hooks.sh')], { cwd: root });

  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** What one commit actually contains, which is the only thing worth asserting. */
function filesIn(s: Scratch, ref = 'HEAD'): readonly string[] {
  return s
    .git('show', '--name-only', '--format=', ref)
    .split('\n')
    .filter((line) => line.trim() !== '');
}

test('the hook keeps the sections in the order the keeper depends on', () => {
  const s = scratch();
  try {
    const text = readFileSync(join(s.root, '.git', 'hooks', 'pre-commit'), 'utf8');
    const gate = text.indexOf('BEGIN CONSTRUCT GATE');
    const beads = text.indexOf('BEGIN BEADS INTEGRATION');
    const keeper = text.indexOf('BEGIN CONSTRUCT TRACKER KEEPER');
    assert.ok(gate !== -1 && beads !== -1 && keeper !== -1, 'all three sections are present');
    assert.ok(gate < beads, 'the gate runs before the section it observes');
    assert.ok(beads < keeper, 'the keeper runs after the section it undoes');
    // The beads section is not this installer's to rewrite.
    assert.match(text, /This section is managed by beads\. Do not remove these markers\./);
  } finally {
    s.cleanup();
  }
});

test('a commit the author did not stage the tracker export into does not carry it', () => {
  const s = scratch();
  try {
    writeFileSync(join(s.root, 'source.txt'), 'changed\n');
    s.git('add', 'source.txt');
    s.git('commit', '-q', '-m', 'a change about something else');
    assert.deepEqual(filesIn(s), ['source.txt']);
  } finally {
    s.cleanup();
  }
});

test('a commit the author staged it into keeps it', () => {
  const s = scratch();
  try {
    writeFileSync(join(s.root, 'source.txt'), 'changed\n');
    writeFileSync(join(s.root, '.beads', 'issues.jsonl'), 'second\n');
    s.git('add', 'source.txt', '.beads/issues.jsonl');
    s.git('commit', '-q', '-m', 'tracker state, deliberately');
    assert.deepEqual([...filesIn(s)].sort(), ['.beads/issues.jsonl', 'source.txt']);
  } finally {
    s.cleanup();
  }
});

test('a pathspec commit carries only its named paths', () => {
  const s = scratch();
  try {
    writeFileSync(join(s.root, 'source.txt'), 'changed\n');
    writeFileSync(join(s.root, 'other.txt'), 'unrelated\n');
    s.git('add', 'other.txt');
    s.git('commit', '-q', '-m', 'only what was named', '--', 'source.txt');
    assert.deepEqual(filesIn(s), ['source.txt']);
  } finally {
    s.cleanup();
  }
});

test('re-running the installer leaves one of each section, not two', () => {
  const s = scratch();
  try {
    execFileSync('bash', [join(s.root, 'scripts', 'install-git-hooks.sh')], { cwd: s.root });
    execFileSync('bash', [join(s.root, 'scripts', 'install-git-hooks.sh')], { cwd: s.root });
    const text = readFileSync(join(s.root, '.git', 'hooks', 'pre-commit'), 'utf8');
    const count = (needle: string): number => text.split(needle).length - 1;
    assert.equal(count('BEGIN CONSTRUCT GATE'), 1);
    assert.equal(count('BEGIN CONSTRUCT TRACKER KEEPER'), 1);
    assert.equal(count('BEGIN BEADS INTEGRATION'), 1);
    // And it still behaves, which is the part a marker count cannot show.
    writeFileSync(join(s.root, 'source.txt'), 'changed again\n');
    s.git('add', 'source.txt');
    s.git('commit', '-q', '-m', 'after reinstalling twice');
    assert.deepEqual(filesIn(s), ['source.txt']);
  } finally {
    s.cleanup();
  }
});
