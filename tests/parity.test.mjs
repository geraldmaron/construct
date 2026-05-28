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

  const agentNames = ['cx-engineer', 'cx-security', 'construct', ...extraAgents];
  const agentObj = {};
  for (const name of agentNames) {
    fs.writeFileSync(path.join(claudeDir, `${name}.md`), 'stub');
    fs.writeFileSync(path.join(codexDir, `${name}.toml`), `name = "${name}"\n`);
    fs.writeFileSync(path.join(copilotDir, `${name}.prompt.md`), 'stub');
    agentObj[name] = {};
  }
  fs.writeFileSync(path.join(opencodeDir, 'opencode.json'), JSON.stringify({ agent: agentObj }));
  fs.writeFileSync(path.join(cursorDir, 'mcp.json'), JSON.stringify({ mcpServers: { github: {}, context7: {} } }));
  fs.writeFileSync(
    path.join(vscodeDir, 'settings.json'),
    JSON.stringify({ 'github.copilot.mcpServers': { github: {}, context7: {} } }),
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

  it('reports drift when an agent is missing from claude', () => {
    resetSurfaces();
    const claudeDir = path.join(tmpHome, '.claude', 'agents');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'cx-engineer.md'), 'stub');
    fs.writeFileSync(path.join(claudeDir, 'construct.md'), 'stub');

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const claude = report.surfaces.find((s) => s.surface === 'claude');
    assert.equal(claude.status, 'drift');
    assert.deepEqual(claude.missing, ['cx-security']);
    assert.equal(report.ok, false);
  });

  it('reports drift when opencode has an extra agent not in registry', () => {
    resetSurfaces();
    const opencodeDir = path.join(tmpHome, '.config', 'opencode');
    fs.mkdirSync(opencodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(opencodeDir, 'opencode.json'),
      JSON.stringify({
        agent: { 'cx-engineer': {}, 'cx-security': {}, construct: {}, 'cx-orphan': {} },
      })
    );
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const opencode = report.surfaces.find((s) => s.surface === 'opencode');
    assert.equal(opencode.status, 'drift');
    assert.deepEqual(opencode.extra, ['cx-orphan']);
  });

  it('reports drift when copilot is missing a prompt', () => {
    resetSurfaces();
    const promptsDir = path.join(tmpHome, '.github', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'cx-engineer.prompt.md'), 'stub');
    fs.writeFileSync(path.join(promptsDir, 'construct.prompt.md'), 'stub');

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const copilot = report.surfaces.find((s) => s.surface === 'copilot');
    assert.equal(copilot.status, 'drift');
    assert.deepEqual(copilot.missing, ['cx-security']);
  });

  it('reports drift when vscode mcp settings are missing a managed server', () => {
    resetSurfaces();
    const vscodeDir = getVsCodeUserDir(tmpHome);
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(vscodeDir, 'settings.json'),
      JSON.stringify({ 'github.copilot.mcpServers': { github: {} } }),
    );

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const vscode = report.surfaces.find((s) => s.surface === 'vscode');
    assert.equal(vscode.status, 'drift');
    assert.deepEqual(vscode.missing, ['context7']);
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

  it('reports drift when codex is missing an agent', () => {
    resetSurfaces();
    const codexDir = path.join(tmpHome, '.codex', 'agents');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'cx-engineer.toml'), 'name = "cx-engineer"\n');
    fs.writeFileSync(path.join(codexDir, 'construct.toml'), 'name = "construct"\n');

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const codex = report.surfaces.find((s) => s.surface === 'codex');
    assert.equal(codex.status, 'drift');
    assert.deepEqual(codex.missing, ['cx-security']);
    assert.equal(report.ok, false);
  });

  it('reports drift when codex has an extra agent not in registry', () => {
    resetSurfaces();
    const codexDir = path.join(tmpHome, '.codex', 'agents');
    fs.mkdirSync(codexDir, { recursive: true });
    for (const f of ['cx-engineer.toml', 'cx-security.toml', 'construct.toml', 'cx-orphan.toml']) {
      fs.writeFileSync(path.join(codexDir, f), `name = "${f.replace('.toml', '')}"\n`);
    }
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    const codex = report.surfaces.find((s) => s.surface === 'codex');
    assert.equal(codex.status, 'drift');
    assert.deepEqual(codex.extra, ['cx-orphan']);
  });

  it('copilot parity uses the same internal-flag rule as Claude/OpenCode/Codex (regression for false-drift)', () => {
    // Pre-fix bug: checkCopilot uniquely dropped entries with internal:true
    // from its expected set while sync writes all 29 to disk. That produced
    // "extra: cx-*" drift for every internal specialist. The fix routes
    // copilot through entriesForSurface, the same helper the other surfaces
    // use. This test would have failed under the old code.
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

  it('respects entry.platforms allowlist when set', () => {
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
    const claudeDir = path.join(tmpHome, '.claude', 'agents');
    fs.mkdirSync(claudeDir, { recursive: true });
    for (const f of ['cx-engineer.md', 'cx-security.md', 'cx-claude-only.md', 'construct.md']) {
      fs.writeFileSync(path.join(claudeDir, f), 'stub');
    }
    const opencodeDir = path.join(tmpHome, '.config', 'opencode');
    fs.mkdirSync(opencodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(opencodeDir, 'opencode.json'),
      JSON.stringify({
        agent: { 'cx-engineer': {}, 'cx-security': {}, construct: {} },
      })
    );

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    assert.equal(report.ok, true, `parity should be ok; got ${JSON.stringify(report.summary)}`);

    fs.writeFileSync(path.join(tmpRoot, 'specialists', 'registry.json'), JSON.stringify(FIXTURE_REGISTRY, null, 2));
  });
});
