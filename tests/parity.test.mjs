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

const FIXTURE_REGISTRY = {
  version: 1,
  system: 'cx',
  prefix: 'cx',
  models: {
    reasoning: { primary: 'anthropic/claude-opus-4-7', fallback: [] },
    standard: { primary: 'anthropic/claude-sonnet-4-6', fallback: [] },
    fast: { primary: 'anthropic/claude-haiku-4-5', fallback: [] },
  },
  agents: [
    { name: 'engineer', description: 'engineer', prompt: 'p', model: 'anthropic/claude-sonnet-4-6' },
    { name: 'security', description: 'sec', prompt: 'p', model: 'anthropic/claude-sonnet-4-6' },
  ],
  personas: [
    {
      name: 'construct',
      displayName: 'Construct',
      description: 'd',
      role: 'r',
      promptFile: 'personas/construct.md',
      model: 'anthropic/claude-opus-4-7',
    },
  ],
};

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-parity-root-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-parity-home-'));
  fs.mkdirSync(path.join(tmpRoot, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'personas'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'agents', 'registry.json'), JSON.stringify(FIXTURE_REGISTRY, null, 2));
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
}

function writeAllSurfaces(extraAgents = []) {
  const claudeDir = path.join(tmpHome, '.claude', 'agents');
  fs.mkdirSync(claudeDir, { recursive: true });
  const opencodeDir = path.join(tmpHome, '.config', 'opencode');
  fs.mkdirSync(opencodeDir, { recursive: true });
  const codexDir = path.join(tmpHome, '.codex', 'agents');
  fs.mkdirSync(codexDir, { recursive: true });

  const agentNames = ['cx-engineer', 'cx-security', 'construct', ...extraAgents];
  const agentObj = {};
  for (const name of agentNames) {
    fs.writeFileSync(path.join(claudeDir, `${name}.md`), 'stub');
    fs.writeFileSync(path.join(codexDir, `${name}.toml`), `name = "${name}"\n`);
    agentObj[name] = {};
  }
  fs.writeFileSync(path.join(opencodeDir, 'opencode.json'), JSON.stringify({ agent: agentObj }));
}

describe('checkParity', () => {
  it('reports absent when no surfaces are installed', () => {
    resetSurfaces();
    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    assert.equal(report.ok, true);
    assert.equal(report.surfaces.find((s) => s.surface === 'claude').status, 'absent');
    assert.equal(report.surfaces.find((s) => s.surface === 'opencode').status, 'absent');
    assert.equal(report.surfaces.find((s) => s.surface === 'codex').status, 'absent');
  });

  it('reports ok when all three surfaces match the registry exactly', () => {
    resetSurfaces();
    writeAllSurfaces();

    const report = checkParity({ rootDir: tmpRoot, homeDir: tmpHome });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.surfaces.find((s) => s.surface === 'codex').status, 'ok');
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

  it('respects entry.platforms allowlist when set', () => {
    resetSurfaces();
    fs.writeFileSync(
      path.join(tmpRoot, 'agents', 'registry.json'),
      JSON.stringify({
        ...FIXTURE_REGISTRY,
        agents: [
          ...FIXTURE_REGISTRY.agents,
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

    fs.writeFileSync(path.join(tmpRoot, 'agents', 'registry.json'), JSON.stringify(FIXTURE_REGISTRY, null, 2));
  });
});
