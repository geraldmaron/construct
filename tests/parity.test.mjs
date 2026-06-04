/**
 * tests/parity.test.mjs — cross-surface parity verifier tests.
 *
 * Builds a fixture registry and a fake $HOME with controlled platform state,
 * then asserts checkParity correctly reports ok / drift / absent per surface.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';

let tmpRoot;
let tmpHome;
let checkParity;

function getVsCodeUserDir(homeDir) {
  if (process.platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User');
  if (process.platform === 'linux') return path.join(homeDir, '.config', 'Code', 'User');
  const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');
  return path.join(appData, 'Code', 'User');
}

const FIXTURE_REGISTRY = {
  version: 1,
  system: 'cx',
  prefix: 'cx',
  models: {
    reasoning: { primary: 'anthropic/claude-opus-4-7', fallback: [] },
    standard: { primary: 'anthropic/claude-sonnet-4-6', fallback: [] },
    fast: { primary: 'anthropic/claude-haiku-4-5', fallback: [] },
  },
  specialists: [
    { name: 'engineer', description: 'engineer', prompt: 'p', model: 'anthropic/claude-sonnet-4-6' },
    { name: 'security', description: 'sec', prompt: 'p', model: 'anthropic/claude-sonnet-4-6' },
  ],
  orchestrator: {
    name: 'construct',
    displayName: 'Construct',
    description: 'd',
    role: 'r',
    promptFile: 'personas/construct.md',
    model: 'anthropic/claude-opus-4-7',
  },
  mcpServers: {
    github: { type: 'url', url: 'https://example.test/github' },
    context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'] },
  },
};

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-parity-root-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-parity-home-'));
  fs.mkdirSync(path.join(tmpRoot, 'specialists'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'personas'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'specialists', 'registry.json'), JSON.stringify(FIXTURE_REGISTRY, null, 2));
  fs.writeFileSync(path.join(tmpRoot, 'personas', 'construct.md'), '# stub\n');
  ({ checkParity } = await import('../lib/parity.mjs'));
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function resetSurfaces() {
  fs.rmSync(path.join(tmpHome, '.claude'), { recursive: true, force: true });
  fs.rmSync(path.join(tmpHome, '.config'), { recursive: true, force: true });
  fs.rmSync(path.join(tmpHome, '.codex'), { recursive: true, force: true });
  fs.rmSync(path.join(tmpHome, '.github'), { recursive: true, force: true });
  fs.rmSync(path.join(tmpHome, '.cursor'), { recursive: true, force: true });
  fs.rmSync(path.join(tmpHome, 'Library'), { recursive: true, force: true });
  fs.rmSync(path.join(tmpHome, 'AppData'), { recursive: true, force: true });
}

/**
 * Two-tier sync contract: user-scope holds only the `construct` front-door
 * agent. cx-* specialists live with each project (`.claude/agents/cx-*.md`
 * inside the repo), not under `~/.claude/agents/`. The parity check
 * mirrors that contract — `writeAllSurfaces` therefore writes only
 * `construct` plus any explicit extras passed in for drift testing.
 */
function writeAllSurfaces(extraAgents = []) {
  const claudeDir = path.join(tmpHome, '.claude', 'agents');
  fs.mkdirSync(claudeDir, { recursive: true });
  const opencodeDir = path.join(tmpHome, '.config', 'opencode');
  fs.mkdirSync(opencodeDir, { recursive: true });
  const codexDir = path.join(tmpHome, '.codex', 'agents');
  fs.mkdirSync(codexDir, { recursive: true });
  const copilotDir = path.join(tmpHome, '.github', 'prompts');
  fs.mkdirSync(copilotDir, { recursive: true });
  const cursorDir = path.join(tmpHome, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  const vscodeDir = getVsCodeUserDir(tmpHome);
  fs.mkdirSync(vscodeDir, { recursive: true });

  const agentNames = ['construct', ...extraAgents];
  const agentObj = {};
  for (const name of agentNames) {
    fs.writeFileSync(path.join(codexDir, `${name}.toml`), `name = "${name}"\n`);
    fs.writeFileSync(path.join(copilotDir, `${name}.prompt.md`), 'stub');
    agentObj[name] = {};
  }
  // User-scope `.claude/agents` ships no front-door agent (project-scoped); only
  // legacy extras (cx-*) may linger there during an upgrade.
  for (const name of extraAgents) {
    fs.writeFileSync(path.join(claudeDir, `${name}.md`), 'stub');
  }
  fs.writeFileSync(path.join(opencodeDir, 'opencode.json'), JSON.stringify({ agent: agentObj }));
  fs.writeFileSync(path.join(cursorDir, 'mcp.json'), JSON.stringify({ mcpServers: { github: {}, context7: {} } }));
  fs.writeFileSync(
    path.join(vscodeDir, 'mcp.json'),
    JSON.stringify({ servers: { github: {}, context7: {} } }),
  );
}

describe('checkParity', () => {
  it('reports absent when no surfaces are installed', () => {
    resetSurfaces();
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    assert.equal(report.ok, true);
    assert.equal(report.surfaces.find((s) => s.surface === 'claude').status, 'absent');
    assert.equal(report.surfaces.find((s) => s.surface === 'opencode').status, 'absent');
    assert.equal(report.surfaces.find((s) => s.surface === 'codex').status, 'absent');
    assert.equal(report.surfaces.find((s) => s.surface === 'copilot').status, 'absent');
    assert.equal(report.surfaces.find((s) => s.surface === 'vscode').status, 'absent');
    assert.equal(report.surfaces.find((s) => s.surface === 'cursor').status, 'absent');
  });

  it('reports ok when all managed surfaces match the registry exactly', () => {
    resetSurfaces();
    writeAllSurfaces();

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.surfaces.find((s) => s.surface === 'codex').status, 'ok');
    assert.equal(report.surfaces.find((s) => s.surface === 'copilot').status, 'ok');
    assert.equal(report.surfaces.find((s) => s.surface === 'vscode').status, 'ok');
    assert.equal(report.surfaces.find((s) => s.surface === 'cursor').status, 'ok');
  });

  it('user-scope claude ships no front-door agent (the project orchestrator is the front door)', () => {
    resetSurfaces();
    const claudeDir = path.join(tmpHome, '.claude', 'agents');
    fs.mkdirSync(claudeDir, { recursive: true });
    // Empty user-scope `.claude/agents` is the correct state — a global agent
    // would double the project orchestrator in editors that read both scopes.

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const claude = report.surfaces.find((s) => s.surface === 'claude');
    assert.equal(claude.status, 'ok');
    assert.deepEqual(claude.missing, []);
  });

  it('reports drift when opencode has a non-registry cx-* agent at user scope', () => {
    resetSurfaces();
    const opencodeDir = path.join(tmpHome, '.config', 'opencode');
    fs.mkdirSync(opencodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(opencodeDir, 'opencode.json'),
      JSON.stringify({
        // cx-orphan isn't in the fixture registry — it's genuine drift, not a
        // legacy v1.0.10 install. (Registry-known cx-* extras are soft-warned
        // as legacy-install; see the dedicated test further down.)

        agent: { construct: {}, 'cx-orphan': {} },
      })
    );
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const opencode = report.surfaces.find((s) => s.surface === 'opencode');
    assert.equal(opencode.status, 'drift');
    assert.deepEqual(opencode.extra, ['cx-orphan']);
  });

  it('reports drift when copilot user-scope prompts are missing the construct front-door', () => {
    resetSurfaces();
    const promptsDir = path.join(tmpHome, '.github', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    // No construct.prompt.md — that's drift under the new contract.

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const copilot = report.surfaces.find((s) => s.surface === 'copilot');
    assert.equal(copilot.status, 'drift');
    assert.deepEqual(copilot.missing, ['construct']);
  });

  it('reports drift when vscode mcp settings are missing a managed server', () => {
    resetSurfaces();
    const vscodeDir = getVsCodeUserDir(tmpHome);
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(vscodeDir, 'mcp.json'),
      JSON.stringify({ servers: { github: {} } }),
    );

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const vscode = report.surfaces.find((s) => s.surface === 'vscode');
    assert.equal(vscode.status, 'drift');
    assert.deepEqual(vscode.missing, ['context7']);
  });

  it('parses JSONC vscode settings (comments + trailing comma) without a false unreadable failure', () => {
    resetSurfaces();
    const vscodeDir = getVsCodeUserDir(tmpHome);
    fs.mkdirSync(vscodeDir, { recursive: true });
    // Valid VS Code settings: line + block comments, a // inside a URL value,
    // and a trailing comma — all rejected by strict JSON.parse.
    fs.writeFileSync(
      path.join(vscodeDir, 'mcp.json'),
      [
        '{',
        '  // managed by construct',
        '  /* VS Code user MCP config */',
        '  "servers": {',
        '    "github": { "url": "https://example.test/github" },',
        '    "context7": {},',
        '  },',
        '}',
      ].join('\n'),
    );
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const vscode = report.surfaces.find((s) => s.surface === 'vscode');
    assert.notEqual(vscode.status, 'unreadable', `vscode JSONC must parse, got ${JSON.stringify(vscode)}`);
    assert.equal(vscode.status, 'ok', JSON.stringify(vscode));
  });

  it('reports drift when cursor mcp config has an extra server', () => {
    resetSurfaces();
    const cursorDir = path.join(tmpHome, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { github: {}, context7: {}, orphan: {} } }),
    );

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const cursor = report.surfaces.find((s) => s.surface === 'cursor');
    assert.equal(cursor.status, 'drift');
    assert.deepEqual(cursor.extra, ['orphan']);
  });

  it('reports drift when codex user-scope is missing the construct front-door', () => {
    resetSurfaces();
    const codexDir = path.join(tmpHome, '.codex', 'agents');
    fs.mkdirSync(codexDir, { recursive: true });
    // No construct.toml — drift under the two-tier contract.

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const codex = report.surfaces.find((s) => s.surface === 'codex');
    assert.equal(codex.status, 'drift');
    assert.deepEqual(codex.missing, ['construct']);
    assert.equal(report.ok, false);
  });

  it('reports drift when codex user-scope has an extra cx-* agent', () => {
    resetSurfaces();
    const codexDir = path.join(tmpHome, '.codex', 'agents');
    fs.mkdirSync(codexDir, { recursive: true });
    for (const f of ['construct.toml', 'cx-orphan.toml']) {
      fs.writeFileSync(path.join(codexDir, f), `name = "${f.replace('.toml', '')}"\n`);
    }
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const codex = report.surfaces.find((s) => s.surface === 'codex');
    assert.equal(codex.status, 'drift');
    assert.deepEqual(codex.extra, ['cx-orphan']);
  });

  it('copilot user-scope parity expects only the construct prompt (two-tier contract)', () => {
    // Under the new contract, internal:true on a specialist has no effect at
    // user scope — cx-* prompts never land at ~/.github/prompts/ regardless
    // of the internal flag. The orchestrator alone is expected.

    resetSurfaces();
    const registryWithInternal = {
      ...FIXTURE_REGISTRY,
      specialists: [
        { ...FIXTURE_REGISTRY.specialists[0], internal: true },
        { ...FIXTURE_REGISTRY.specialists[1], internal: true },
      ],
    };
    fs.writeFileSync(path.join(tmpRoot, 'specialists', 'registry.json'), JSON.stringify(registryWithInternal, null, 2));
    writeAllSurfaces();
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const copilot = report.surfaces.find((s) => s.surface === 'copilot');
    assert.equal(copilot.status, 'ok', `copilot drift: missing=${copilot.missing}, extra=${copilot.extra}`);
    fs.writeFileSync(path.join(tmpRoot, 'specialists', 'registry.json'), JSON.stringify(FIXTURE_REGISTRY, null, 2));
  });

  it('entry.platforms allowlist still excludes a specialist from off-list surfaces', () => {
    // Even at project scope (not exercised here), a `platforms: ['claude']`
    // specialist must not land in opencode/codex/copilot. At user scope only
    // the construct front-door is expected — adding cx-* of any kind is
    // drift regardless of platform allowlist.

    resetSurfaces();
    fs.writeFileSync(
      path.join(tmpRoot, 'specialists', 'registry.json'),
      JSON.stringify({
        ...FIXTURE_REGISTRY,
        specialists: [
          ...FIXTURE_REGISTRY.specialists,
          { name: 'claude-only', description: 'd', prompt: 'p', model: 'anthropic/claude-sonnet-4-6', platforms: ['claude'] },
        ],
      })
    );
    writeAllSurfaces();

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    assert.equal(report.ok, true, `parity should be ok with only construct at user scope; got ${JSON.stringify(report.summary)}`);

    fs.writeFileSync(path.join(tmpRoot, 'specialists', 'registry.json'), JSON.stringify(FIXTURE_REGISTRY, null, 2));
  });

  it('reclassifies drift to legacy-install when all extras are known cx-* specialists', () => {
    // Simulates a dev box mid-upgrade from v1.0.10 (which populated cx-*
    // specialists at user scope) to v1.0.13+ (project scope only). Extras
    // are all from the registry's specialist roster — soft-warn, not drift,
    // and overall parity stays ok so the gate doesn't hard-fail.

    resetSurfaces();
    writeAllSurfaces(['cx-engineer', 'cx-security']);
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    assert.equal(report.ok, true, `legacy install should not hard-fail; got ${JSON.stringify(report.summary)}`);
    const claude = report.surfaces.find((s) => s.surface === 'claude');
    assert.equal(claude.status, 'legacy-install');
    assert.deepEqual(claude.extra.sort(), ['cx-engineer', 'cx-security']);
    assert.match(report.summary.join('\n'), /legacy v1\.0\.10 install/);
    assert.match(report.summary.join('\n'), /--fix-legacy-agents/);
  });

  it('keeps real drift hard-failing when an extra is not in the legacy roster', () => {
    // The soft-warn fires only when *every* extra matches a registry cx-*
    // name. A single unknown name (typo, user-authored extension) flips
    // back to hard fail.

    resetSurfaces();
    writeAllSurfaces(['cx-engineer', 'cx-unknown-thing']);
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    assert.equal(report.ok, false, `mixed legacy + unknown should still hard-fail; got ${JSON.stringify(report.summary)}`);
    const claude = report.surfaces.find((s) => s.surface === 'claude');
    assert.equal(claude.status, 'drift');
  });
});
