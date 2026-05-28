/**
 * tests/functional/sync-no-double-frontmatter.functional.test.mjs
 *
 * End-to-end coverage for the user-reported sync bug. Spawns the real
 * `scripts/sync-specialists.mjs` ONCE against an isolated tmpdir HOME and
 * runs every assertion against the resulting tree. Asserts:
 *   - Every emitted SKILL.md (under ~/.claude/skills and ~/.agents/skills)
 *     starts with Anthropic Agent Skills frontmatter (name + description) and
 *     carries no Construct doc-stamp keys.
 *   - Every emitted Claude Code agent (~/.claude/agents/*.md) and Copilot
 *     prompt (~/.github/prompts/*.prompt.md) has exactly ONE frontmatter
 *     block (was: doc-stamp on top, real frontmatter underneath = broken).
 *   - The user-managed ~/.claude/CLAUDE.md and ~/.github/copilot-instructions.md
 *     do not carry a doc-stamp prefix.
 *   - Codex .toml output is untouched (regression guard — TOML never stamped).
 *
 * Single shared sync run because the node test runner parallelizes test
 * cases inside a file. Concurrent sync invocations trip .cx/sync.lock and
 * fail with "Another sync is already running".
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-specialists.mjs');

const DOC_STAMP_KEYS = ['cx_doc_id', 'body_hash', 'generator: construct/sync-specialists'];

let SHARED_HOME;
let SYNC_RESULT;

before(() => {
  SHARED_HOME = mkdtempSync(join(tmpdir(), 'sync-iso-home-'));
  SYNC_RESULT = spawnSync(process.execPath, [SYNC_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, HOME: SHARED_HOME },
  });
});

after(() => {
  if (SHARED_HOME) rmSync(SHARED_HOME, { recursive: true, force: true });
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

test('sync run itself exits cleanly against the isolated HOME', () => {
  assert.equal(SYNC_RESULT.status, 0, `sync exited ${SYNC_RESULT.status}\nstderr:\n${SYNC_RESULT.stderr}`);
});

test('sync emits Anthropic Agent Skills frontmatter on every SKILL.md (regression for 141-files-dropped bug)', () => {
  const skillsDirs = [
    join(SHARED_HOME, '.agents', 'skills'),
    join(SHARED_HOME, '.claude', 'skills'),
  ];

  let totalChecked = 0;
  for (const root of skillsDirs) {
    const files = walk(root, (f) => f.endsWith('SKILL.md'));
    assert.ok(files.length > 0, `expected SKILL.md files under ${root}`);
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      assert.match(content, /^---\nname:\s*\S+/, `${file}: must start with name frontmatter`);
      assert.match(content, /^description:\s*"/m, `${file}: must have description frontmatter`);
      assertNoDocStamp(file, 'SKILL.md');
      totalChecked++;
    }
  }
  // 141 skills × 2 dirs = 282 files expected. Allow some growth.
  assert.ok(totalChecked >= 200, `expected ≥200 SKILL.md files, got ${totalChecked}`);
});

test('sync produces exactly one frontmatter block per Claude Code agent and Copilot prompt', () => {
  const agentFiles = walk(join(SHARED_HOME, '.claude', 'agents'), (f) => f.endsWith('.md'));
  assert.ok(agentFiles.length > 0, 'expected Claude agent files');
  for (const file of agentFiles) {
    const content = readFileSync(file, 'utf8');
    const fences = countFrontmatterFences(content);
    assert.equal(fences, 2, `${file}: must have exactly one frontmatter block (got ${fences} fences)`);
    assertNoDocStamp(file, 'Claude agent');
  }

  const promptFiles = walk(join(SHARED_HOME, '.github', 'prompts'), (f) => f.endsWith('.prompt.md'));
  assert.ok(promptFiles.length > 0, 'expected Copilot prompt files');
  for (const file of promptFiles) {
    const content = readFileSync(file, 'utf8');
    const fences = countFrontmatterFences(content);
    assert.equal(fences, 2, `${file}: must have exactly one frontmatter block (got ${fences} fences)`);
    assertNoDocStamp(file, 'Copilot prompt');
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
  const tomlDir = join(SHARED_HOME, '.codex', 'agents');
  if (!existsSync(tomlDir)) return;
  const tomls = walk(tomlDir, (f) => f.endsWith('.toml'));
  for (const file of tomls) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /cx_doc_id/, `${file}: TOML must not contain doc-stamp keys`);
    assert.doesNotMatch(content, /^---\s*$/m, `${file}: TOML must not have YAML frontmatter`);
  }
});
