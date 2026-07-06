/**
 * tests/functional/sync-respects-scope.functional.test.mjs
 *
 * End-to-end coverage for the two-tier sync scope model:
 *
 *   --global mode  → writes only the `construct` front-door agent to user-scope
 *                    paths (`~/.claude/agents/`, `~/.codex/agents/`, etc.).
 *                    Specialists, slash commands, and skills do NOT land.
 *   --project mode → writes all 29 registered agents (`construct` + 28 `cx-*`),
 *                    slash commands, skills, and MCP wiring to the cwd project
 *                    (`<project>/.claude/`, `.codex/`, `.opencode/`, `.github/`,
 *                    `.cursor/`, `.vscode/`). User-scope is untouched.
 *
 * Three cases, each isolated in a tmp HOME + tmp project, asserting on the
 * filesystem aftermath of spawning the real sync-specialists.mjs.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-specialists.mjs');

// `construct sync` now defaults to detected hosts (ADR-0027 §1); a sterile HOME
// detects none, so pin the full set to audit the cross-host scope model.

const ALL_HOSTS = 'claude,codex,copilot,opencode,vscode,cursor';

function makeIsolatedEnv() {
  const sandbox = mkdtempSync(join(tmpdir(), 'sync-scope-'));
  const HOME = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: project });
  return {
    sandbox, HOME, project,
    cleanup() { rmTmpDir(sandbox); },
  };
}

function runSync(env, args, cwd) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, ...args], {
    cwd: cwd || env.project,
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      HOME: env.HOME,
      CONSTRUCT_SKIP_POSTINSTALL: '1',
      CONSTRUCT_SYNC_HOSTS: ALL_HOSTS,
    },
  });
}

function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext) && !f.startsWith('.'));
}

function snapshotHome(HOME) {
  const out = {};
  for (const sub of ['.claude/agents', '.codex/agents', '.github/prompts']) {
    out[sub] = listFiles(join(HOME, sub), '');
  }
  return out;
}

test('--global writes the front-door for Codex/Copilot but no Claude agent (VS Code reads ~/.claude/agents and would double it)', () => {
  const env = makeIsolatedEnv();
  try {
    const result = runSync(env, ['--global']);
    assert.equal(result.status, 0, `sync --global failed: ${result.stderr}`);

    const claudeAgents = listFiles(join(env.HOME, '.claude/agents'), '.md');
    assert.deepEqual(claudeAgents, [], 'global ~/.claude/agents writes no agent — the project orchestrator is the front door (avoids the VS Code construct ×2)');

    const codexAgents = listFiles(join(env.HOME, '.codex/agents'), '.toml');
    assert.deepEqual(codexAgents, ['construct.toml'], 'global ~/.codex/agents must contain only construct.toml');

    const copilotPrompts = listFiles(join(env.HOME, '.github/prompts'), '.prompt.md');
    assert.deepEqual(copilotPrompts, ['construct.prompt.md'], 'global ~/.github/prompts must contain only construct.prompt.md');

    assert.ok(!existsSync(join(env.HOME, '.claude/skills')), 'global mode must not write skills');
    assert.ok(!existsSync(join(env.HOME, '.claude/commands')), 'global mode must not write slash commands');
  } finally {
    env.cleanup();
  }
});

test('--project writes every agent into the project and leaves HOME untouched', () => {
  const env = makeIsolatedEnv();
  try {
    const before = snapshotHome(env.HOME);

    const result = runSync(env, ['--project']);
    assert.equal(result.status, 0, `sync --project failed: ${result.stderr}`);

    const projectAgents = listFiles(join(env.project, '.claude/agents'), '.md');
    assert.deepEqual(projectAgents, ['construct.md'], 'project must include ONLY construct.md (Single Front Door)');

    const projectCodex = listFiles(join(env.project, '.codex/agents'), '.toml');
    assert.deepEqual(projectCodex, ['construct.toml'], 'project must include ONLY construct.toml');

    const projectCopilot = listFiles(join(env.project, '.github/prompts'), '.prompt.md');
    assert.deepEqual(projectCopilot, ['construct.prompt.md'], 'project must include ONLY construct.prompt.md');

    assert.ok(existsSync(join(env.project, '.opencode/opencode.json')), 'project must write .opencode/opencode.json (a path OpenCode reads)');
    assert.ok(!existsSync(join(env.project, '.opencode/config.json')), 'project must NOT write .opencode/config.json (OpenCode never reads it)');
    assert.ok(existsSync(join(env.project, '.vscode/mcp.json')), 'project must write .vscode/mcp.json');
    assert.ok(existsSync(join(env.project, '.cursor/mcp.json')), 'project must write .cursor/mcp.json');
    assert.ok(existsSync(join(env.project, '.cursor/rules/construct.mdc')), 'project must write .cursor/rules/construct.mdc');

    const skillCount = existsSync(join(env.project, '.claude/skills'))
      ? readdirSync(join(env.project, '.claude/skills'), { recursive: true }).filter((f) => f.endsWith('SKILL.md')).length
      : 0;
    assert.ok(skillCount >= 50, `expected skills in project, got ${skillCount}`);

    const after = snapshotHome(env.HOME);
    assert.deepEqual(after, before, 'HOME must be untouched by --project sync');
  } finally {
    env.cleanup();
  }
});

test('user-authored cx-* files with names outside the registry are NOT swept', () => {
  const env = makeIsolatedEnv();
  try {
    mkdirSync(join(env.HOME, '.claude/agents'), { recursive: true });
    mkdirSync(join(env.HOME, '.github/prompts'), { recursive: true });
    mkdirSync(join(env.HOME, '.codex/agents'), { recursive: true });

    writeFileSync(join(env.HOME, '.claude/agents/cx-architect.md'), 'managed legacy\n');
    writeFileSync(join(env.HOME, '.claude/agents/cx-mytool.md'), 'USER FILE — keep me\n');
    writeFileSync(join(env.HOME, '.github/prompts/cx-mytool.prompt.md'), 'USER FILE — keep me\n');
    writeFileSync(join(env.HOME, '.codex/agents/cx-mytool.toml'), '# USER FILE\nname = "cx-mytool"\n');

    const r = runSync(env, ['--global']);
    assert.equal(r.status, 0, `--global failed: ${r.stderr}`);

    assert.ok(!existsSync(join(env.HOME, '.claude/agents/cx-architect.md')), 'managed cx-architect.md should be swept');
    assert.ok(existsSync(join(env.HOME, '.claude/agents/cx-mytool.md')), 'user cx-mytool.md must NOT be swept');
    assert.ok(existsSync(join(env.HOME, '.github/prompts/cx-mytool.prompt.md')), 'user cx-mytool.prompt.md must NOT be swept');
    assert.ok(existsSync(join(env.HOME, '.codex/agents/cx-mytool.toml')), 'user cx-mytool.toml must NOT be swept');
  } finally {
    env.cleanup();
  }
});

test('user-managed blocks in CLAUDE.md and copilot-instructions.md are preserved across sync', () => {
  const env = makeIsolatedEnv();
  try {
    mkdirSync(join(env.HOME, '.claude'), { recursive: true });
    mkdirSync(join(env.HOME, '.github'), { recursive: true });
    const userClaudeMd = '# Claude Global Instructions\n\n## My personal section\n\nKeep me intact across sync.\n';
    const userCopilot = '# GitHub Copilot Instructions\n\n## My personal section\n\nKeep me intact across sync.\n';
    writeFileSync(join(env.HOME, '.claude/CLAUDE.md'), userClaudeMd);
    writeFileSync(join(env.HOME, '.github/copilot-instructions.md'), userCopilot);

    const r = runSync(env, ['--global']);
    assert.equal(r.status, 0);

    const claudeAfter = readFileSync(join(env.HOME, '.claude/CLAUDE.md'), 'utf8');
    assert.ok(claudeAfter.includes('My personal section'), 'CLAUDE.md user content must survive sync');
    assert.ok(claudeAfter.includes('BEGIN CONSTRUCT AGENTS'), 'CLAUDE.md must carry the managed block');

    const copilotAfter = readFileSync(join(env.HOME, '.github/copilot-instructions.md'), 'utf8');
    assert.ok(copilotAfter.includes('My personal section'), 'copilot-instructions.md user content must survive sync');
    assert.ok(copilotAfter.includes('BEGIN CONSTRUCT AGENTS'), 'copilot-instructions.md must carry the managed block');
  } finally {
    env.cleanup();
  }
});

test('legacy cx-* files at HOME are swept by --global sync (idempotent)', () => {
  const env = makeIsolatedEnv();
  try {
    for (const sub of ['.claude/agents', '.codex/agents', '.github/prompts']) {
      mkdirSync(join(env.HOME, sub), { recursive: true });
    }
    for (const name of ['cx-architect', 'cx-engineer', 'cx-reviewer']) {
      writeFileSync(join(env.HOME, '.claude/agents', `${name}.md`), 'legacy\n');
      writeFileSync(join(env.HOME, '.codex/agents', `${name}.toml`), 'legacy\n');
      writeFileSync(join(env.HOME, '.github/prompts', `${name}.prompt.md`), 'legacy\n');
    }

    const r1 = runSync(env, ['--global']);
    assert.equal(r1.status, 0, `first --global failed: ${r1.stderr}`);

    let claudeAgents = listFiles(join(env.HOME, '.claude/agents'), '.md');
    assert.deepEqual(claudeAgents.sort(), [], 'legacy cx-* and the front-door agent must be swept from ~/.claude/agents');

    let codexAgents = listFiles(join(env.HOME, '.codex/agents'), '.toml');
    assert.deepEqual(codexAgents.sort(), ['construct.toml']);

    let copilotPrompts = listFiles(join(env.HOME, '.github/prompts'), '.prompt.md');
    assert.deepEqual(copilotPrompts.sort(), ['construct.prompt.md']);

    const r2 = runSync(env, ['--global']);
    assert.equal(r2.status, 0, `second --global failed: ${r2.stderr}`);

    claudeAgents = listFiles(join(env.HOME, '.claude/agents'), '.md');
    assert.deepEqual(claudeAgents.sort(), [], 'second sync must be a no-op for filename set');
  } finally {
    env.cleanup();
  }
});
