import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DelegationWorkspace } from '../../../src/hosts/delegation/workspace.ts';
import { repository } from './support.ts';

test('dirty scoped files and untracked additions survive snapshots; returned patch is worker-only', () => {
  const fixture = repository();
  try {
    writeFileSync(join(fixture.root, 'src/value.txt'), 'user change\n');
    writeFileSync(join(fixture.root, 'src/new.txt'), 'user addition\n');
    writeFileSync(join(fixture.root, 'README.md'), 'unrelated dirty work\n');
    const index = fixture.git('diff', '--cached');
    const workspace = new DelegationWorkspace(fixture.artifactsDir, fixture.env);
    const snapshot = workspace.prepare(fixture.execution, null);
    assert.equal(readFileSync(join(snapshot.directory, 'src/value.txt'), 'utf8'), 'user change\n');
    assert.equal(readFileSync(join(snapshot.directory, 'src/new.txt'), 'utf8'), 'user addition\n');
    writeFileSync(join(snapshot.directory, 'src/value.txt'), 'user change\nworker addition\n');
    const artifact = workspace.collect({ ...fixture.execution, snapshot });
    const patch = readFileSync(artifact.patch, 'utf8');
    assert.match(patch, /\+worker addition/);
    assert.doesNotMatch(patch, /\+user addition|unrelated dirty work/);
    workspace.integrate({ ...fixture.execution, snapshot, artifact });
    assert.equal(readFileSync(join(fixture.root, 'src/value.txt'), 'utf8'), 'user change\nworker addition\n');
    assert.equal(readFileSync(join(fixture.root, 'README.md'), 'utf8'), 'unrelated dirty work\n');
    assert.equal(fixture.git('diff', '--cached'), index);
    assert.equal(fixture.git('rev-list', '--count', 'HEAD').trim(), '1');
  } finally { fixture.cleanup(); }
});

test('scope, symlink, credential, reviewer-write and stale-target violations are rejected', () => {
  const fixture = repository();
  try {
    const workspace = new DelegationWorkspace(fixture.artifactsDir, fixture.env);
    const snapshot = workspace.prepare(fixture.execution, null);
    writeFileSync(join(snapshot.directory, 'README.md'), 'out of scope\n');
    assert.throws(() => workspace.collect({ ...fixture.execution, snapshot }), /out-of-scope/);
    writeFileSync(join(snapshot.directory, 'README.md'), 'fixture\n');
    writeFileSync(join(snapshot.directory, 'src/value.txt'), 'worker\n');
    assert.throws(() => workspace.collect({ ...fixture.execution, snapshot, assignment: { ...fixture.execution.assignment, role: 'review' } }), /reviewer changed/);
    const artifact = workspace.collect({ ...fixture.execution, snapshot });
    writeFileSync(join(fixture.root, 'src/value.txt'), 'intervening user edit\n');
    assert.throws(() => workspace.integrate({ ...fixture.execution, snapshot, artifact }), /target changed/);
    assert.equal(readFileSync(join(fixture.root, 'src/value.txt'), 'utf8'), 'intervening user edit\n');
    symlinkSync(fixture.home, join(snapshot.directory, 'src/escape'));
    assert.throws(() => workspace.collect({ ...fixture.execution, snapshot }), /symlink/);
    writeFileSync(join(fixture.root, 'src/credential.txt'), `sk-ant-${'a1'.repeat(30)}`);
    assert.throws(() => workspace.prepare({ ...fixture.execution, id: 'credential' }, null), /credential/);
  } finally { fixture.cleanup(); }
});

test('review and repair use the exact artifact and the original integration baseline', () => {
  const fixture = repository();
  try {
    const workspace = new DelegationWorkspace(fixture.artifactsDir, fixture.env);
    const snapshot = workspace.prepare(fixture.execution, null);
    writeFileSync(join(snapshot.directory, 'src/value.txt'), 'first implementation\n');
    const artifact = workspace.collect({ ...fixture.execution, snapshot });
    const subject = { ...fixture.execution, snapshot, artifact };
    const review = { ...fixture.execution, id: 'review', assignment: { ...fixture.execution.assignment, role: 'review' as const, subject: subject.id } };
    const reviewSnapshot = workspace.prepare(review, subject);
    assert.equal(readFileSync(join(reviewSnapshot.directory, 'src/value.txt'), 'utf8'), 'first implementation\n');
    const repair = { ...fixture.execution, id: 'repair', assignment: { ...fixture.execution.assignment, repairOf: subject.id } };
    const repairSnapshot = workspace.prepare(repair, subject);
    workspace.recordRepairBaseline(repair, subject);
    writeFileSync(join(repairSnapshot.directory, 'src/value.txt'), 'repaired implementation\n');
    const repairedArtifact = workspace.collect({ ...repair, snapshot: repairSnapshot });
    workspace.integrate({ ...repair, snapshot: repairSnapshot, artifact: repairedArtifact });
    assert.equal(readFileSync(join(fixture.root, 'src/value.txt'), 'utf8'), 'repaired implementation\n');
  } finally { fixture.cleanup(); }
});

test('host configuration and private paths are excluded and cannot be supplied as explicit scope', () => {
  const fixture = repository();
  try {
    mkdirSync(join(fixture.root, '.claude'));
    writeFileSync(join(fixture.root, '.claude/settings.json'), '{}');
    const workspace = new DelegationWorkspace(fixture.artifactsDir, fixture.env);
    assert.throws(() => workspace.prepare({ ...fixture.execution, assignment: { ...fixture.execution.assignment, paths: ['.claude/'] } }, null), /private|host-control/);
  } finally { fixture.cleanup(); }
});

test('disjoint patches integrate serially while overlapping target changes still conflict', () => {
  const fixture = repository();
  try {
    const workspace = new DelegationWorkspace(fixture.artifactsDir, fixture.env);
    const first = fixture.execution;
    const second = { ...fixture.execution, id: 'second', assignment: { ...fixture.execution.assignment, paths: ['README.md'] } };
    const firstSnapshot = workspace.prepare(first, null);
    const secondSnapshot = workspace.prepare(second, null);
    writeFileSync(join(firstSnapshot.directory, 'src/value.txt'), 'worker\n');
    writeFileSync(join(secondSnapshot.directory, 'README.md'), 'second worker\n');
    const firstArtifact = workspace.collect({ ...first, snapshot: firstSnapshot });
    const secondArtifact = workspace.collect({ ...second, snapshot: secondSnapshot });
    workspace.integrate({ ...first, snapshot: firstSnapshot, artifact: firstArtifact });
    workspace.integrate({ ...second, snapshot: secondSnapshot, artifact: secondArtifact });
    assert.equal(readFileSync(join(fixture.root, 'README.md'), 'utf8'), 'second worker\n');
    assert.equal(readFileSync(join(fixture.root, 'src/value.txt'), 'utf8'), 'worker\n');
  } finally { fixture.cleanup(); }
});

test('patch proposals cannot write outside scope or create symlinks', () => {
  const fixture = repository();
  try {
    const workspace = new DelegationWorkspace(fixture.artifactsDir, fixture.env);
    const snapshot = workspace.prepare(fixture.execution, null);
    const execution = { ...fixture.execution, snapshot };
    assert.throws(() => workspace.applyProposal(execution, 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-fixture\n+bad\n'), /allowed paths/);
    assert.throws(() => workspace.applyProposal(execution, 'diff --git a/src/link b/src/link\nnew file mode 120000\n--- /dev/null\n+++ b/src/link\n@@ -0,0 +1 @@\n+/outside\n'), /regular files/);
    assert.equal(readFileSync(join(fixture.root, 'README.md'), 'utf8'), 'fixture\n');
    writeFileSync(join(snapshot.directory, '.git'), 'gitdir: /outside\n');
    assert.throws(() => workspace.collect(execution), /worktree identity/);
  } finally { fixture.cleanup(); }
});
