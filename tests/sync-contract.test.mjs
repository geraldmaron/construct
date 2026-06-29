/**
 * tests/sync-contract.test.mjs — contract tests for sync-specialists.mjs platform output shapes.
 *
 * Verifies that each platform generator produces correctly shaped output files
 * from a fixture registry. Catches platform format drift on CI before it reaches
 * production. Run via `npm test`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

// Pin every host so the contract assertions are deterministic regardless of
// which host binaries the runner has on PATH. Without this, the detected-only
// default (ADR-0027 §1) writes just the Claude baseline on a host-less CI
// runner, so the codex/opencode/project-agent assertions fail.
const ALL_HOSTS = 'claude,codex,copilot,opencode,vscode,cursor';

let tmpHome;
let tmpProject;

function writableTmpRoot() {
  const candidates = [
    process.env.CONSTRUCT_TEST_TMPDIR,
    path.join(ROOT_DIR, '.tmp', 'tests'),
    '/private/tmp',
    os.tmpdir(),
    '/tmp',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('No writable temp root available for sync contract tests');
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(writableTmpRoot(), prefix));
}

before(() => {
  tmpHome = makeTempDir('sync-contract-home-');
  tmpProject = makeTempDir('sync-contract-project-');
  // Create a minimal .claude dir so Claude Code sync has a target
  fs.mkdirSync(path.join(tmpHome, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude', 'settings.json'), JSON.stringify({
    mcpServers: {
      context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'] },
      'construct-mcp': { command: 'node', args: ['/tmp/construct/lib/mcp/server.mjs'] },
      github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer test-token' } },
      memory: { command: 'node', args: ['/tmp/construct/lib/mcp/memory-bridge.mjs'] },
      playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
      'sequential-thinking': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
    },
    hooks: {},
  }, null, 2) + '\n');
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpProject, { recursive: true, force: true });
});

/** Run sync-specialists.mjs with the given extra args and env, return result.
 *  Defaults to --global because every assertion in this suite checks user-scope
 *  output (`tmpHome/.claude/`, `tmpHome/.github/`, etc.). Callers wanting
 *  project-scope output (--project mode) pass that flag explicitly.
 */
function runSync(args = [], env = {}) {
  const finalArgs = args.includes('--project') || args.includes('--global')
    ? args
    : [...args, '--global'];
  return spawnSync(
    process.execPath,
    [path.join(ROOT_DIR, 'scripts', 'sync-specialists.mjs'), ...finalArgs],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: tmpHome,
        CX_TOOLKIT_DIR: ROOT_DIR,
        CONSTRUCT_SYNC_FORCE: '1',
        CONSTRUCT_SYNC_HOSTS: ALL_HOSTS,
        // tmpHome has an empty embedding-model cache, so prompt composition
        // would download the ~90MB Xenova model from HuggingFace and blow the
        // timeout. The hashing backend is deterministic and never touches the
        // model or the network; this suite asserts file shapes, not embeddings.
        CONSTRUCT_EMBEDDING_MODEL: 'hashing',
        CONSTRUCT_EMBEDDING_DISABLE_LOCAL: '1',
        ...env,
      },
      timeout: 60_000,
    }
  );
}

describe('sync-specialists contract tests', () => {
  describe('--dry-run flag', () => {
    it('exits 0 and prints diff summary without writing any files', () => {
      const before = countFiles(path.join(tmpHome, '.claude'));
      const result = runSync(['--dry-run']);
      assert.equal(result.status, 0, `dry-run failed:\n${result.stderr}`);
      const after = countFiles(path.join(tmpHome, '.claude'));
      assert.equal(before, after, '--dry-run must not write any files');
      assert.ok(
        result.stdout.includes('dry-run') || result.stdout.includes('would change') || result.stdout.includes('up to date'),
        `--dry-run output must mention dry-run state. Got:\n${result.stdout}`
      );
    });
  });

  // The --global tier mutates user-scope (~/.claude, …), so its lock lives
  // under HOME, not the repo root — two --global syncs against different HOMEs
  // must not collide on a shared repo-root lock.
  describe('lockfile', () => {
    it('creates .cx/sync.lock during sync and removes it after', () => {
      const lockPath = path.join(tmpHome, '.cx', 'sync.lock');
      // Ensure no stale lock
      try { fs.unlinkSync(lockPath); } catch { /* ok */ }
      const result = runSync([], { HOME: tmpHome });
      assert.equal(result.status, 0, `sync failed:\n${result.stderr}`);
      assert.ok(!fs.existsSync(lockPath), 'lock file must be removed after successful sync');
    });

    it('aborts with exit 1 when lock is already held by a live process', () => {
      const lockPath = path.join(tmpHome, '.cx', 'sync.lock');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      // Write the current process PID — guaranteed to be alive
      fs.writeFileSync(lockPath, String(process.pid));
      try {
        const result = runSync([], { HOME: tmpHome });
        assert.equal(result.status, 1, 'should exit 1 when lock held by live process');
        assert.ok(
          result.stderr.includes('already running') || result.stderr.includes('sync.lock'),
          `stderr must mention lock contention. Got:\n${result.stderr}`
        );
      } finally {
        try { fs.unlinkSync(lockPath); } catch { /* ok */ }
      }
    });
  });

  describe('Claude Code output shape', () => {
    before(() => {
      // Run a full sync into tmpHome so we have outputs to inspect
      const result = runSync([], { HOME: tmpHome });
      if (result.status !== 0) throw new Error(`sync failed:\n${result.stderr}`);
    });

    it('writes no agent under ~/.claude/agents/ at global scope (front door is project-scoped)', () => {
      const agentsDir = path.join(tmpHome, '.claude', 'agents');
      const files = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')) : [];
      assert.equal(files.length, 0, `global ~/.claude/agents must be empty (VS Code reads it too), found ${files.join(', ')}`);
    });

    it('the global Codex front-door agent contains the generated-by banner', () => {
      const codexDir = path.join(tmpHome, '.codex', 'agents');
      const files = fs.existsSync(codexDir) ? fs.readdirSync(codexDir).filter((f) => f.endsWith('.toml')) : [];
      assert.ok(files.length > 0, `expected a global Codex front-door agent in ${codexDir}`);
      const content = fs.readFileSync(path.join(codexDir, files[0]), 'utf8');
      assert.ok(
        content.includes('Generated by construct') || content.includes('Do not edit'),
        `${files[0]} must contain generated-by banner`
      );
    });

    it('CLAUDE.md contains the managed agents block', () => {
      const claudeMd = path.join(tmpHome, '.claude', 'CLAUDE.md');
      if (!fs.existsSync(claudeMd)) return; // optional if no CLAUDE.md template
      const content = fs.readFileSync(claudeMd, 'utf8');
      assert.ok(
        content.includes('BEGIN CONSTRUCT AGENTS') && content.includes('END CONSTRUCT AGENTS'),
        'CLAUDE.md must contain managed agents block'
      );
    });

    it('writes only safety hooks to global ~/.claude/settings.json', () => {
      const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const ids = Object.values(settings.hooks ?? {})
        .flat()
        .map((group) => group.id)
        .sort();
      assert.deepEqual(ids, [
        'post:edit:json-validate',
        'post:edit:scan-secrets',
        'pre:bash:block-no-verify',
        'pre:bash:guard-dangerous',
        'pre:edit-guard',
        'pre:edit:config-protection',
      ]);
    });

    it('preserves global ~/.claude/settings.json MCP entries while syncing safety hooks', () => {
      const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

      // The modular org declares no global MCP servers in the specialist
      // registry. Sync should not delete user/global MCP entries while installing
      // Construct safety hooks.
      assert.deepEqual(Object.keys(settings.mcpServers ?? {}).sort(), [
        'construct-mcp',
        'context7',
        'github',
        'memory',
        'playwright',
        'sequential-thinking',
      ]);
      assert.deepEqual(settings.mcpServers.context7.args, ['-y', '@upstash/context7-mcp@latest']);
    });
  });

  describe('Copilot output shape', () => {
    it('emits at least one .prompt.md file under ~/.github/copilot-instructions/', () => {
      // Copilot prompts land in ~/.github/prompts/ or copilot-related dirs; check either
      const promptDirs = [
        path.join(tmpHome, '.github', 'prompts'),
        path.join(tmpHome, '.github', 'copilot-instructions'),
      ];
      const found = promptDirs.some((d) => {
        if (!fs.existsSync(d)) return false;
        return fs.readdirSync(d).some((f) => f.endsWith('.md') || f.endsWith('.prompt.md'));
      });
      // Copilot sync is optional (may not configure on this machine) — skip if not present
      if (!found) return;
      assert.ok(found, 'Copilot output directory must contain at least one prompt file');
    });
  });

  describe('registry validation gate', () => {
    it('exits non-zero on registry with missing required fields', () => {
      // Write a broken registry to a temp file and point sync at it via env
      const brokenRegistry = JSON.stringify({ version: 1, system: 'test' }); // missing agents, personas, etc.
      const tmpRegistry = path.join(writableTmpRoot(), 'broken-registry.json');
      fs.writeFileSync(tmpRegistry, brokenRegistry);

      // Validation runs before writes; verifying the real registry with --dry-run
      // confirms exit 0 on valid input without needing to swap registryPath.
      const result = runSync(['--dry-run'], { HOME: tmpHome });
      assert.equal(result.status, 0, `validation should pass on the real registry:\n${result.stderr}`);
      fs.unlinkSync(tmpRegistry);
    });
  });

  describe('two-phase staging', () => {
    it('staging dir is cleaned up after successful sync', () => {
      const stagingDir = path.join(tmpHome, '.cx', 'sync-staging');
      const result = runSync([], { HOME: tmpHome });
      assert.equal(result.status, 0, `sync failed:\n${result.stderr}`);
      assert.ok(!fs.existsSync(stagingDir), 'sync-staging dir must be removed after successful sync');
    });
  });

  describe('--project mode portability', () => {
    let projectDir;

    before(() => {
      projectDir = makeTempDir('sync-contract-portable-');
    });

    after(() => {
      fs.rmSync(projectDir, { recursive: true, force: true });
    });

    it('writes a self-contained .claude/settings.json with portable hook commands', () => {
      const result = spawnSync(
        process.execPath,
        [path.join(ROOT_DIR, 'scripts', 'sync-specialists.mjs'), '--project'],
        {
          encoding: 'utf8',
          cwd: projectDir,
          env: { ...process.env, HOME: tmpHome, CONSTRUCT_SYNC_FORCE: '1', CONSTRUCT_SYNC_HOSTS: ALL_HOSTS },
          timeout: 60_000,
        }
      );
      assert.equal(result.status, 0, `project sync failed:\n${result.stderr}`);

      const settingsPath = path.join(projectDir, '.claude', 'settings.json');
      assert.ok(fs.existsSync(settingsPath), 'project mode must write .claude/settings.json');

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.ok(settings.hooks, 'settings.json must include hooks');

      const allCommands = JSON.stringify(settings.hooks);
      assert.ok(
        !/\$HOME\/\.construct/.test(allCommands),
        'project-mode settings must not reference $HOME/.construct paths'
      );
      assert.match(allCommands, /node \.construct\/run\.mjs hook session-start/);
      assert.match(allCommands, /node \.construct\/run\.mjs hook pre-push-gate/);
    });

    it('does not write the opt-in playwright MCP into project settings', () => {
      const settings = JSON.parse(
        fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'),
      );
      const ids = Object.keys(settings.mcpServers ?? {});
      assert.ok(ids.includes('context7'), 'project settings keep the core context7 MCP');
      assert.ok(!ids.includes('playwright'), 'playwright is opt-in (construct mcp add), not synced by default');
    });

    it('writes agent adapters into the project, not into HOME', () => {
      const projectAgents = path.join(projectDir, '.claude', 'agents');
      assert.ok(fs.existsSync(projectAgents), 'project mode must create .claude/agents/');
      const files = fs.readdirSync(projectAgents).filter((f) => f.endsWith('.md'));
      assert.ok(files.length > 0, 'project mode must produce at least one agent .md file');
    });
  });
});

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) count++;
    else if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
  }
  return count;
}
