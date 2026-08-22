/**
 * tests/scripts/install-git-hooks.test.ts — the pre-commit hook the installer
 * writes, exercised against a real scratch repository rather than a mock,
 * because what is under test is what git actually commits.
 *
 * The beads section is stubbed by a block that does exactly the one thing this
 * repository cares about: it stages the tracker export unconditionally. That is
 * the behavior the keeper exists to undo, and stubbing it keeps the test off a
 * real tracker database while still exercising the real arrangement, since the
 * installer preserves whatever it finds and arms the keeper ahead of it.
 *
 * There is a second stub that stages and then fails, because the real beads
 * section exits the hook on its own failures and that path is where the keeper
 * was once unreachable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

/**
 * The same section, failing the way the real one does: it stages the export and
 * then exits the hook itself, so nothing written after it in the file runs.
 */
const FAILING_BEADS_STUB = `# --- BEGIN BEADS INTEGRATION v1.0.3 ---
# This section is managed by beads. Do not remove these markers.
printf 'exported\\n' >> .beads/issues.jsonl
git add .beads/issues.jsonl
exit 1
# --- END BEADS INTEGRATION v1.0.3 ---
`;

interface Scratch {
  readonly root: string;
  git(...args: string[]): string;
  /** Exit code and combined output, for the commits that are meant to fail. */
  tryCommit(...args: string[]): number;
  cleanup(): void;
}

function scratch(beadsStub: string = BEADS_STUB): Scratch {
  const root = mkdtempSync(join(tmpdir(), 'construct-hooks-'));
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const tryCommit = (...args: string[]): number => {
    const result = spawnSync('git', ['-C', root, 'commit', ...args], { encoding: 'utf8' });
    return result.status ?? -1;
  };

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
  writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), `#!/usr/bin/env bash\n${beadsStub}`, {
    mode: 0o755,
  });
  execFileSync('bash', [join(root, 'scripts', 'install-git-hooks.sh')], { cwd: root });

  return { root, git, tryCommit, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** What the index holds right now, which is what leaks between commits. */
function staged(s: Scratch): readonly string[] {
  return s
    .git('diff', '--cached', '--name-only')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/** What one commit actually contains, which is the only thing worth asserting. */
function filesIn(s: Scratch, ref = 'HEAD'): readonly string[] {
  return s
    .git('show', '--name-only', '--format=', ref)
    .split('\n')
    .filter((line) => line.trim() !== '');
}

test('the keeper is armed before the section it undoes, and is a trap', () => {
  const s = scratch();
  try {
    const text = readFileSync(join(s.root, '.git', 'hooks', 'pre-commit'), 'utf8');
    const gate = text.indexOf('BEGIN CONSTRUCT GATE');
    const beads = text.indexOf('BEGIN BEADS INTEGRATION');
    assert.ok(gate !== -1 && beads !== -1, 'both sections are present');
    assert.ok(gate < beads, 'the gate runs before the section it observes');
    // Arming, not appending: the keeper has to survive the beads section
    // exiting the hook, and only a trap does.
    assert.match(text, /trap _construct_keep_tracker EXIT/);
    assert.ok(
      text.indexOf('trap _construct_keep_tracker EXIT') < beads,
      'the trap is armed before the section that can exit past it',
    );
    // The old trailing section is gone, not merely outvoted: two keepers would
    // run twice, and the second run reads a state the first one cleared.
    assert.ok(!text.includes('BEGIN CONSTRUCT TRACKER KEEPER'), 'no trailing keeper section');
    // The beads section is not this installer's to rewrite.
    assert.match(text, /This section is managed by beads\. Do not remove these markers\./);
  } finally {
    s.cleanup();
  }
});

test('a beads section that stages and then fails leaves nothing staged behind it', () => {
  // The bug this pins: the keeper used to be trailing lines, and the beads
  // section exits the hook itself when its own run fails. The export it had
  // already staged then sat in the index — where the NEXT commit's gate read it
  // as the author's own staging and kept it, attaching every bead any session
  // touched to a commit about something else. The failure the keeper exists to
  // prevent was reachable through the keeper not running.
  const s = scratch(FAILING_BEADS_STUB);
  try {
    writeFileSync(join(s.root, 'source.txt'), 'changed\n');
    s.git('add', 'source.txt');
    assert.notEqual(s.tryCommit('-q', '-m', 'the tracker hook fails on this one'), 0);
    assert.deepEqual(staged(s), ['source.txt'], 'the export did not survive the failed hook');
  } finally {
    s.cleanup();
  }
});

test('a commit after a failed tracker hook does not inherit its staging', () => {
  // The second half, and the one that actually cost something: a leftover
  // staging is indistinguishable from an author's own, so the misattribution
  // lands on the next commit rather than the failed one.
  const s = scratch(FAILING_BEADS_STUB);
  try {
    writeFileSync(join(s.root, 'source.txt'), 'changed\n');
    s.git('add', 'source.txt');
    assert.notEqual(s.tryCommit('-q', '-m', 'fails'), 0);

    // Now the tracker hook works again, as it would on the next attempt.
    writeFileSync(join(s.root, '.git', 'hooks', 'pre-commit'), `#!/usr/bin/env bash\n${BEADS_STUB}`, {
      mode: 0o755,
    });
    execFileSync('bash', [join(s.root, 'scripts', 'install-git-hooks.sh')], { cwd: s.root });
    s.git('commit', '-q', '-m', 'a change about something else');
    assert.deepEqual(filesIn(s), ['source.txt']);
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
    assert.equal(count('BEGIN BEADS INTEGRATION'), 1);
    // Two traps would be one keeper too many: the second reads a state the
    // first already cleared, and would unstage an export the author staged.
    assert.equal(count('trap _construct_keep_tracker EXIT'), 1);
    // And it still behaves, which is the part a marker count cannot show.
    writeFileSync(join(s.root, 'source.txt'), 'changed again\n');
    s.git('add', 'source.txt');
    s.git('commit', '-q', '-m', 'after reinstalling twice');
    assert.deepEqual(filesIn(s), ['source.txt']);
  } finally {
    s.cleanup();
  }
});
