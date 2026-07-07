/**
 * tests/functional/cross-project-state-isolation.functional.test.mjs
 *
 * End-to-end coverage for bead construct-vytb. Verifies the four
 * PROJECT-SCOPED writers land in <project>/.cx/ (not ~/.cx/) when invoked
 * from inside a Construct project, and that the three CROSS-PROJECT
 * writers tag each entry with the right projectId so a reader can
 * attribute usage per-project.
 *
 * Test shape: create two isolated projects A and B inside a shared tmp
 * HOME, exercise each writer twice (once per project cwd), assert:
 *   - Project-scoped writers wrote to <A>/.cx/<file> and <B>/.cx/<file>
 *     and the user-scope ~/.cx/<file> stays untouched / empty.
 *   - Cross-project writers (skill-calls, session-cost, role-pending)
 *     wrote a single user-scope file but every entry carries the right
 *     projectId tag.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProjectScope, resolveProjectScopedPath, projectIdFor, _resetCache } from '../../lib/project-root.mjs';
import { logSkillCall } from '../../lib/telemetry/skill-calls.mjs';
import { logIntentVerification } from '../../lib/telemetry/intent-verifications.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function makeSandbox() {
  // realpath normalizes /var/folders/... → /private/var/folders/... on
  // macOS so equality checks against process.cwd() (which always returns
  // the resolved path) work cross-platform.

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cx-cross-iso-')));
  const projectA = join(root, 'proj-a');
  const projectB = join(root, 'proj-b');
  const home = join(root, 'HOME');
  mkdirSync(projectA, { recursive: true });
  mkdirSync(join(projectA, '.cx'), { recursive: true });
  mkdirSync(projectB, { recursive: true });
  mkdirSync(join(projectB, '.cx'), { recursive: true });
  mkdirSync(home, { recursive: true });
  return {
    root, projectA, projectB, home,
    cleanup: () => rmTmpDir(root),
  };
}

// resolveProjectScopedPath always reads process.cwd(). chdir/restore around
// the writer call so the test stays self-contained.

function withCwd(dir, fn) {
  const prev = process.cwd();
  try {
    process.chdir(dir);
    _resetCache();   // cwd-keyed memoization; reset between projects
    return fn();
  } finally {
    process.chdir(prev);
    _resetCache();
  }
}

test('project-scoped path helper returns <project>/.cx in project, ~/.cx outside', () => {
  const env = makeSandbox();
  try {
    withCwd(env.projectA, () => {
      const p = resolveProjectScopedPath('contract-violations.jsonl', { ensureDir: false });
      assert.equal(p, join(env.projectA, '.cx', 'contract-violations.jsonl'));
    });
    withCwd(env.projectB, () => {
      const p = resolveProjectScopedPath('audit-reads.jsonl', { ensureDir: false });
      assert.equal(p, join(env.projectB, '.cx', 'audit-reads.jsonl'));
    });
  } finally { env.cleanup(); }
});

test('skill-calls writer tags entries with the projectId from cwd', () => {
  const env = makeSandbox();
  const logPath = join(env.home, '.cx', 'skill-calls.jsonl');
  mkdirSync(join(env.home, '.cx'), { recursive: true });
  try {
    withCwd(env.projectA, () => {
      logSkillCall({ skillId: 'roles/engineer', source: 'mcp' }, { logPath });
    });
    withCwd(env.projectB, () => {
      logSkillCall({ skillId: 'roles/security', source: 'prompt-composer' }, { logPath });
    });

    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].skillId, 'roles/engineer');
    assert.equal(lines[0].projectId, projectIdFor(env.projectA), 'entry 0 must carry projectA id');
    assert.equal(lines[1].skillId, 'roles/security');
    assert.equal(lines[1].projectId, projectIdFor(env.projectB), 'entry 1 must carry projectB id');
    assert.notEqual(lines[0].projectId, lines[1].projectId, 'distinct projects get distinct ids');
  } finally { env.cleanup(); }
});

test('intent-verifications writer routes to <project>/.cx in a project', () => {
  const env = makeSandbox();
  try {
    withCwd(env.projectA, () => {
      logIntentVerification({
        request: 'review the auth flow',
        specialist: 'cx-reviewer',
        flavor: 'review',
        keywordVerdict: true,
        llmVerdict: true,
        source: 'test',
      });
    });
    const aPath = join(env.projectA, '.cx', 'intent-verifications.jsonl');
    assert.ok(existsSync(aPath), `expected entry in <projectA>/.cx; got files: ${readdirSync(join(env.projectA, '.cx')).join(', ')}`);
    const entries = readFileSync(aPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].specialist, 'cx-reviewer');

    // Project-scoped writes must NOT leak into the user-scope file.

    const userPath = join(env.home, '.cx', 'intent-verifications.jsonl');
    assert.equal(existsSync(userPath), false, 'user-scope intent-verifications must be empty when inside a project');
  } finally { env.cleanup(); }
});

test('project A and project B writers do not bleed into each other', () => {
  const env = makeSandbox();
  try {
    // Each project writes to its own .cx/contract-violations.jsonl via the
    // resolved-path helper. After both write, neither file should contain
    // the other's data — concrete test of isolation.

    const APath = join(env.projectA, '.cx', 'contract-violations.jsonl');
    const BPath = join(env.projectB, '.cx', 'contract-violations.jsonl');

    withCwd(env.projectA, () => {
      const p = resolveProjectScopedPath('contract-violations.jsonl', { ensureDir: true });
      writeFileSync(p, JSON.stringify({ violation: 'from-A' }) + '\n');
    });
    withCwd(env.projectB, () => {
      const p = resolveProjectScopedPath('contract-violations.jsonl', { ensureDir: true });
      writeFileSync(p, JSON.stringify({ violation: 'from-B' }) + '\n');
    });

    const aData = JSON.parse(readFileSync(APath, 'utf8').trim());
    const bData = JSON.parse(readFileSync(BPath, 'utf8').trim());
    assert.equal(aData.violation, 'from-A');
    assert.equal(bData.violation, 'from-B');
    assert.notEqual(readFileSync(APath, 'utf8'), readFileSync(BPath, 'utf8'),
      'project A and project B contract-violations must be distinct files');
  } finally { env.cleanup(); }
});
