/**
 * tests/functional/skills-surface.functional.test.mjs
 *
 * Hermetic skills verification: lean init + project sync must
 * install readable Claude skill trees, keep retired Construct 1.0 teaching out
 * of synced SKILL.md bodies, and prove MCP get_skill / search_skills return
 * non-empty usable content (not exit-only sync smoke). Also pins the
 * Contract: sync writes `.claude/skills/` only
 * and prunes refused host mirrors (`.agents/skills`, `.cursor/skills`, …).
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');
const SERVER = path.join(REPO, 'lib', 'mcp', 'server.mjs');

const CRITICAL_SKILLS = [
  'docs/artifact-authorship',
  'brand/output-vibe',
  'quality-gates/verify-change',
  'quality-gates/review-work',
  'perspectives/product-manager',
];

const SKILL_TREES = ['docs', 'brand', 'quality-gates', 'perspectives'];

const V1_BANNED = Object.freeze([
  { id: 'cli-workflow-invoke', re: /construct\s+workflow\s+invoke/i },
  { id: 'mcp-workflow-invoke', re: /\bworkflow_invoke\b/ },
  { id: 'mcp-list-teams', re: /\blist_teams\b/ },
  { id: 'mermaid-handdrawn-theme', re: /look\s*:\s*handDrawn|handDrawn\s*:\s*true/ },
  { id: 'caveat-publish-font', re: /Caveat\.ttf|fontFamily\s*[:=]\s*['"]Caveat['"]/ },
  { id: 'persona-phase-owners', re: /Treat personas as phase owners/i },
  { id: 'dispatching-specialists', re: /dispatching specialists autonomously/i },
  { id: 'specialist-chain-teaching', re: /\bspecialist chain\b/i },
]);

function makeProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-skills-surface-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-skills-surface-home-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  spawnSync('git', ['config', 'user.email', 'skills-surface@example.com'], { cwd: project });
  spawnSync('git', ['config', 'user.name', 'Skills Surface'], { cwd: project });
  return { project, home };
}

function spawnEnv(home, overrides = {}) {
  // Sterile PATH matches init-all-hosts-cursor: host CLIs on a developer
  // machine must not expand `sync --project` beyond the lean Claude contract
  // under test (and must not invite host-side skill scaffolding into the
  // project tmpdir).
  const sterilePath = [
    path.dirname(process.execPath),
    '/usr/bin',
    '/bin',
  ].join(path.delimiter);

  return sterileSpawnEnv({
    HOME: home,
    CONSTRUCT_HOME_OVERRIDE: home,
    CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
    BOOTSTRAP_CHECKED: '1',
    CONSTRUCT_SKIP_POSTINSTALL: '1',
    CI: 'true',
    NODE_ENV: 'test',
    PATH: sterilePath,
    ...overrides,
  });
}

function listRel(root, max = 40) {
  if (!fs.existsSync(root)) return '(missing)';
  const out = [];
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(entry.isDirectory() ? `${rel}/` : rel);
      if (out.length >= max) return;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    }
  };
  walk(root);
  return out.join('\n') || '(empty)';
}

function assertNoSkillsMirror(project, relDir, label) {
  const full = path.join(project, ...relDir.split('/'));
  if (!fs.existsSync(full)) return;
  const listing = listRel(full);
  assert.fail(
    `${label}: refused skills mirror present at ${relDir}\n${listing}`,
  );
}

function mcpClient(cwd, home) {
  const child = spawn(process.execPath, [SERVER], {
    cwd,
    env: spawnEnv(home, {
      CONSTRUCT_TOOLKIT_DIR: REPO,
      CONSTRUCT_MCP_TOOL_TIMEOUT_MS: '15000',
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { buffer: '', frames: [] };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.buffer += chunk;
    let idx;
    while ((idx = state.buffer.indexOf('\n')) >= 0) {
      const raw = state.buffer.slice(0, idx).trim();
      state.buffer = state.buffer.slice(idx + 1);
      if (raw) {
        try { state.frames.push(JSON.parse(raw)); } catch { /* non-JSON noise */ }
      }
    }
  });
  const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
  const waitFor = (id, timeoutMs = 20_000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const hit = state.frames.find((f) => f.id === id);
      if (hit) return resolve(hit);
      if (Date.now() >= deadline) {
        return reject(new Error(`timeout waiting for id=${id}; frames=${state.frames.length}`));
      }
      setTimeout(tick, 40);
    };
    tick();
  });
  return {
    send,
    waitFor,
    kill: () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } },
  };
}

function envelopePayload(frame) {
  const text = frame?.result?.content?.[0]?.text;
  assert.equal(typeof text, 'string', 'tool must return a text envelope');
  return JSON.parse(text);
}

function collectSkillMd(skillsRoot) {
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { recursive: true })
    .filter((f) => String(f).endsWith('SKILL.md'))
    .map((f) => path.join(skillsRoot, f));
}

function scanV1Teaching(files, skillsRoot) {
  const hits = [];
  for (const file of files) {
    const rel = path.relative(skillsRoot, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const ban of V1_BANNED) {
        if (ban.re.test(line)) {
          hits.push(`${rel}:${index + 1} [${ban.id}] ${line.trim()}`);
        }
        ban.re.lastIndex = 0;
      }
    });
  }
  return hits;
}

test('lean init + sync installs Claude skills; MCP get_skill/search_skills return bodies', async (t) => {
  const { project, home } = makeProject();
  t.after(() => {
    rmTmpDir(project);
    rmTmpDir(home);
  });

  const env = spawnEnv(home);

  const init = spawnSync(process.execPath, [BIN, 'init', '--yes', '--no-start', '--no-beads'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 180_000,
    env,
  });
  assert.equal(init.status, 0, `init failed: ${init.stderr}\n${init.stdout}`);

  assert.ok(fs.existsSync(path.join(project, '.claude')), 'lean init must stage .claude');
  assert.ok(
    !fs.existsSync(path.join(project, '.codex', 'agents', 'construct.toml')),
    'lean init must not stage Codex adapters',
  );
  assert.ok(
    !fs.existsSync(path.join(project, '.opencode', 'opencode.json')),
    'lean init must not stage OpenCode adapters',
  );
  assert.ok(
    !fs.existsSync(path.join(project, '.cursor', 'mcp.json')),
    'lean init must not stage Cursor adapters',
  );

  // Pin Claude only — bare `sync --project` follows PATH detection and would
  // re-expand adapters on a loaded machine, fighting the lean-init contract.
  const sync = spawnSync(process.execPath, [BIN, 'sync', '--project', '--hosts=claude'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 180_000,
    env,
  });
  assert.equal(sync.status, 0, `sync --project --hosts=claude failed: ${sync.stderr}\n${sync.stdout}`);

  // Plant a refused mirror before asserting postconditions — sync must leave
  // none behind even if a host CLI or stale dual-write created one mid-run.
  const plantedAgents = path.join(project, '.agents', 'skills', 'planted', 'SKILL.md');
  fs.mkdirSync(path.dirname(plantedAgents), { recursive: true });
  fs.writeFileSync(plantedAgents, '---\nname: planted\ndescription: should be removed\n---\nplanted\n');
  const prune = spawnSync(process.execPath, [BIN, 'sync', '--project', '--hosts=claude'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 180_000,
    env,
  });
  assert.equal(prune.status, 0, `prune sync failed: ${prune.stderr}\n${prune.stdout}`);
  assert.match(prune.stdout, /removed refused skills mirror/, 'sync must report refused-mirror prune');
  assert.ok(!fs.existsSync(path.join(project, '.agents', 'skills')), 'planted .agents/skills must be removed');

  const skillsRoot = path.join(project, '.claude', 'skills');
  const skillFiles = collectSkillMd(skillsRoot);
  assert.ok(skillFiles.length >= 50, `expected >=50 synced SKILL.md files, got ${skillFiles.length}`);

  for (const tree of SKILL_TREES) {
    assert.ok(fs.existsSync(path.join(skillsRoot, tree)), `missing skill tree: ${tree}`);
  }

  for (const id of CRITICAL_SKILLS) {
    const skillPath = path.join(skillsRoot, id, 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), `missing critical skill: ${id}`);
    const body = fs.readFileSync(skillPath, 'utf8');
    assert.ok(body.length > 200, `${id} must be readable content, got ${body.length} bytes`);
    assert.match(body, /^---\n/, `${id} must start with Anthropic skill frontmatter`);
  }

  // Relative `](../…)` links resolve from skills/<cat>/<name>.md but break under
  // .claude/skills/<cat>/<name>/SKILL.md (extra nesting). Sync copies bodies as-is.
  const climbHits = [];
  const climbRe = /\[[^\]]*\]\((\.\.\/[^)\s]+)\)/g;
  for (const file of skillFiles) {
    const rel = path.relative(skillsRoot, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    let m;
    climbRe.lastIndex = 0;
    while ((m = climbRe.exec(text)) !== null) climbHits.push(`${rel}: ${m[0]}`);
  }
  assert.deepEqual(
    climbHits,
    [],
    `synced SKILL.md still has relative climb links (use backtick repo paths):\n${climbHits.join('\n')}`,
  );

  // Cursor loads.claude/skills/ natively — no host-tree skills mirrors.
  assertNoSkillsMirror(project, '.codex/skills', 'skills must not land under .codex');
  assertNoSkillsMirror(project, '.opencode/skills', 'skills must not land under .opencode');
  assertNoSkillsMirror(project, '.cursor/skills', 'skills must not land under .cursor');
  assertNoSkillsMirror(project, '.agents/skills', 'skills must not land under .agents');
  assertNoSkillsMirror(home, '.agents/skills', 'skills must not land under HOME/.agents');

  const sample = [
    ...CRITICAL_SKILLS.map((id) => path.join(skillsRoot, id, 'SKILL.md')),
    ...skillFiles.slice(0, 40),
  ].filter((p, i, arr) => arr.indexOf(p) === i && fs.existsSync(p));
  const hits = scanV1Teaching(sample, skillsRoot);
  assert.deepEqual(hits, [], `synced SKILL.md still teaches Construct 1.0 patterns:\n${hits.join('\n')}`);

  const c = mcpClient(project, home);
  let id = 0;
  try {
    c.send({
      jsonrpc: '2.0',
      id: ++id,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'skills-surface', version: '1' },
      },
    });
    await c.waitFor(id);
    c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const listId = ++id;
    c.send({ jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} });
    const listed = await c.waitFor(listId);
    const names = (listed.result?.tools || []).map((t) => t.name);
    assert.ok(names.includes('get_skill'), 'get_skill must be on the flat core surface');
    assert.ok(names.includes('search_skills'), 'search_skills must be on the flat core surface');

    for (const skillPath of ['docs/artifact-authorship', 'brand/output-vibe']) {
      const callId = ++id;
      c.send({
        jsonrpc: '2.0',
        id: callId,
        method: 'tools/call',
        params: { name: 'get_skill', arguments: { path: skillPath } },
      });
      const payload = envelopePayload(await c.waitFor(callId));
      assert.equal(payload.error, undefined, `get_skill(${skillPath}) must not error: ${JSON.stringify(payload)}`);
      assert.equal(typeof payload.content, 'string', `get_skill(${skillPath}) must return content`);
      assert.ok(payload.content.length > 200, `get_skill(${skillPath}) body too short: ${payload.content.length}`);
    }

    const searchId = ++id;
    c.send({
      jsonrpc: '2.0',
      id: searchId,
      method: 'tools/call',
      params: { name: 'search_skills', arguments: { pattern: 'artifact authorship' } },
    });
    const searchPayload = envelopePayload(await c.waitFor(searchId));
    assert.ok(
      Array.isArray(searchPayload.results) && searchPayload.results.length > 0,
      `search_skills must return matches: ${JSON.stringify(searchPayload).slice(0, 300)}`,
    );
  } finally {
    c.kill();
  }
});
