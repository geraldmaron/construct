/**
 * tests/functional/sync-no-double-frontmatter.functional.test.mjs
 *
 * End-to-end coverage for the sync-frontmatter regression class. Spawns the
 * real `scripts/sync-specialists.mjs` ONCE in --global mode against an
 * isolated HOME and ONCE in --project mode against a tmp project root, then
 * runs every assertion against the resulting trees. Asserts:
 *   - Every emitted SKILL.md (under <project>/.claude/skills/) starts with
 *     Anthropic Agent Skills frontmatter (name + description) and carries no
 *     Construct doc-stamp keys.
 *   - Every emitted Claude Code agent (in both ~/.claude/agents/ and
 *     <project>/.claude/agents/) and Copilot prompt has exactly ONE
 *     frontmatter block (was: doc-stamp on top, real frontmatter underneath).
 *   - The user-managed ~/.claude/CLAUDE.md and ~/.github/copilot-instructions.md
 *     do not carry a doc-stamp prefix.
 *   - Codex .toml output is untouched (regression guard — TOML never stamped).
 *
 * Single shared sync runs because the node test runner parallelizes test
 * cases inside a file. Concurrent sync invocations trip .cx/sync.lock.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-specialists.mjs');

// `construct sync` now defaults to detected hosts (ADR-0027 §1); a sterile HOME
// detects none, so pin the full set to exercise every adapter writer.

const ALL_HOSTS = 'claude,codex,copilot,opencode,vscode,cursor';

const DOC_STAMP_KEYS = ['cx_doc_id', 'body_hash', 'generator: construct/sync-specialists'];

let SHARED_HOME;
let SHARED_PROJECT;
let GLOBAL_RESULT;
let PROJECT_RESULT;

before(() => {
  SHARED_HOME = mkdtempSync(join(tmpdir(), 'sync-iso-home-'));
  SHARED_PROJECT = mkdtempSync(join(tmpdir(), 'sync-iso-project-'));
  mkdirSync(join(SHARED_PROJECT, '.git'), { recursive: true });
  GLOBAL_RESULT = spawnSync(process.execPath, [SYNC_SCRIPT, '--global'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, HOME: SHARED_HOME, CONSTRUCT_SYNC_HOSTS: ALL_HOSTS },
  });
  PROJECT_RESULT = spawnSync(process.execPath, [SYNC_SCRIPT, '--project'], {
    cwd: SHARED_PROJECT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, HOME: SHARED_HOME, CONSTRUCT_SYNC_HOSTS: ALL_HOSTS },
  });
});

after(() => {
  if (SHARED_HOME) rmTmpDir(SHARED_HOME);
  if (SHARED_PROJECT) rmTmpDir(SHARED_PROJECT);
});

function walk(dir, predicate) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, predicate));
    else if (entry.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

function countFrontmatterFences(content) {
  return (content.match(/^---\s*$/gm) || []).length;
}

function assertNoDocStamp(filePath, label) {
  const content = readFileSync(filePath, 'utf8');
  for (const key of DOC_STAMP_KEYS) {
    assert.doesNotMatch(
      content,
      new RegExp(`^${key}`, 'm'),
      `${label}: ${filePath} still carries doc-stamp key "${key}"`,
    );
  }
}

test('sync run itself exits cleanly against the isolated HOME and project', () => {
  assert.equal(GLOBAL_RESULT.status, 0, `--global sync exited ${GLOBAL_RESULT.status}\nstderr:\n${GLOBAL_RESULT.stderr}`);
  assert.equal(PROJECT_RESULT.status, 0, `--project sync exited ${PROJECT_RESULT.status}\nstderr:\n${PROJECT_RESULT.stderr}`);
});

test('sync emits Anthropic Agent Skills frontmatter on every SKILL.md (regression for 141-files-dropped bug)', () => {
  const skillsRoot = join(SHARED_PROJECT, '.claude', 'skills');
  const files = walk(skillsRoot, (f) => f.endsWith('SKILL.md'));
  assert.ok(files.length > 0, `expected SKILL.md files under ${skillsRoot}`);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    assert.match(content, /^---\nname:\s*\S+/, `${file}: must start with name frontmatter`);
    assert.match(content, /^description:\s*\S/m, `${file}: must have description frontmatter`);
    assertNoDocStamp(file, 'SKILL.md');
  }
  assert.ok(files.length >= 100, `expected ≥100 SKILL.md files in project, got ${files.length}`);
});

test('sync produces exactly one frontmatter block per Claude Code agent and Copilot prompt (global + project)', () => {
  // Global ~/.claude/agents ships no agent (front door is project-scoped), so
  // the Claude agent check runs against the project scope only.
  const agentDirs = [
    join(SHARED_PROJECT, '.claude', 'agents'),
  ];
  for (const dir of agentDirs) {
    const agentFiles = walk(dir, (f) => f.endsWith('.md'));
    assert.ok(agentFiles.length > 0, `expected Claude agent files under ${dir}`);
    for (const file of agentFiles) {
      const content = readFileSync(file, 'utf8');
      const fences = countFrontmatterFences(content);
      assert.equal(fences, 2, `${file}: must have exactly one frontmatter block (got ${fences} fences)`);
      assertNoDocStamp(file, 'Claude agent');
    }
  }

  const promptDirs = [
    join(SHARED_HOME, '.github', 'prompts'),
    join(SHARED_PROJECT, '.github', 'prompts'),
  ];
  for (const dir of promptDirs) {
    const promptFiles = walk(dir, (f) => f.endsWith('.prompt.md'));
    assert.ok(promptFiles.length > 0, `expected Copilot prompt files under ${dir}`);
    for (const file of promptFiles) {
      const content = readFileSync(file, 'utf8');
      const fences = countFrontmatterFences(content);
      assert.equal(fences, 2, `${file}: must have exactly one frontmatter block (got ${fences} fences)`);
      assertNoDocStamp(file, 'Copilot prompt');
    }
  }
});

test('sync does not doc-stamp user-managed CLAUDE.md or copilot-instructions.md', () => {
  const claudeMd = join(SHARED_HOME, '.claude', 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    assertNoDocStamp(claudeMd, '~/.claude/CLAUDE.md');
  }
  const copilotInstructions = join(SHARED_HOME, '.github', 'copilot-instructions.md');
  if (existsSync(copilotInstructions)) {
    assertNoDocStamp(copilotInstructions, '~/.github/copilot-instructions.md');
  }
});

test('Codex agent TOML stays untouched (.toml was never stamped — regression guard)', () => {
  const tomlDirs = [
    join(SHARED_HOME, '.codex', 'agents'),
    join(SHARED_PROJECT, '.codex', 'agents'),
  ];
  for (const dir of tomlDirs) {
    if (!existsSync(dir)) continue;
    const tomls = walk(dir, (f) => f.endsWith('.toml'));
    for (const file of tomls) {
      const content = readFileSync(file, 'utf8');
      assert.doesNotMatch(content, /cx_doc_id/, `${file}: TOML must not contain doc-stamp keys`);
      assert.doesNotMatch(content, /^---\s*$/m, `${file}: TOML must not have YAML frontmatter`);
    }
  }
});
