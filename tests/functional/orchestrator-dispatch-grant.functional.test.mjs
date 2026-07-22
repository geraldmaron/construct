/**
 * tests/functional/orchestrator-dispatch-grant.functional.test.mjs
 *
 * The orchestrator's contract is classify-then-dispatch: orchestration_policy then
 * orchestration_run. Both halves must be reachable on every host or the orchestrator
 * refuses instead of routing (the "I can't connect to the internet" failure). This
 * guards two layers that together restore cross-host parity:
 *   - server surface: both tools are flat in exposedTools() (reachable on every host,
 *     not buried behind the `call` gateway);
 *   - generated config: Claude's hard tools allowlist names both; OpenCode does not
 *     deny them (allow-by-default); Codex seeds construct-mcp with no per-agent gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exposedTools } from '../../lib/mcp/server.mjs';
import { createHostSandbox, fingerprintRealConfigs, assertRealConfigsUnchanged } from '../helpers/sterile-host-env.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('orchestration_policy and orchestration_run are both flat on the MCP surface', () => {
  const names = exposedTools().map((t) => t.name);
  assert.ok(names.includes('orchestration_policy'), 'classify step is flat');
  assert.ok(names.includes('orchestration_run'), 'dispatch step is flat — without it the prompt names a tool no host advertises');
});

test('every host grants the orchestrator both dispatch tools', () => {
  const before = fingerprintRealConfigs();
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    mkdirSync(join(sandbox.root, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(sandbox.root, '.claude', 'settings.json'), JSON.stringify({ mcpServers: {} }));

    // sync-worker-profiles.mjs derives its own root from import.meta.dirname and
    // self-populates CONSTRUCT_TOOLKIT_DIR from it when unset — it never needs the
    // var supplied externally. Setting it here would also feed
    // lib/paths.mjs's constructDir(), which lib/state-root.mjs's
    // machine-scoped state root (ADR-0066) builds on, redirecting real state
    // into repoRoot instead of the sandboxed HOME.
    const r = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'sync-worker-profiles.mjs'), '--project'], {
      cwd: sandbox.root,
      env: { ...sandbox.env, CONSTRUCT_SYNC_HOSTS: 'claude,opencode,codex' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);

    const claudeAgent = readFileSync(join(sandbox.root, '.claude', 'agents', 'construct.md'), 'utf8');
    const toolsLine = claudeAgent.split('\n').find((l) => l.startsWith('tools:')) ?? '';
    assert.match(toolsLine, /\borchestration_policy\b/, 'Claude allowlist names orchestration_policy');
    assert.match(toolsLine, /\borchestration_run\b/, 'Claude allowlist names orchestration_run');

    const opencode = JSON.parse(readFileSync(join(sandbox.root, '.opencode', 'opencode.json'), 'utf8'));
    const ocPerms = opencode.agent?.construct?.permission ?? {};
    for (const tool of ['orchestration_policy', 'orchestration_run']) {
      for (const key of [tool, `construct-mcp_${tool}`, `mcp__construct-mcp__${tool}`]) {
        assert.notEqual(ocPerms[key], 'deny', `OpenCode must not deny ${key} to the orchestrator`);
      }
    }
    assert.ok(opencode.mcp?.['construct-mcp'], 'OpenCode wires the construct-mcp server');

    const codexConfig = readFileSync(join(sandbox.root, '.codex', 'config.toml'), 'utf8');
    assert.match(codexConfig, /\[mcp_servers\."construct-mcp"\]/, 'Codex seeds the construct-mcp server');
    const codexAgent = join(sandbox.root, '.codex', 'agents', 'construct.toml');
    assert.ok(existsSync(codexAgent), 'Codex emits the orchestrator agent');
    const codexAgentText = readFileSync(codexAgent, 'utf8');
    assert.match(codexAgentText, /orchestration_run/, 'Codex orchestrator instructions reference the dispatch step');
    assert.doesNotMatch(codexAgentText, /^tools\s*=/m, 'Codex applies no per-agent tool allowlist that could block dispatch');

    assertRealConfigsUnchanged(before);
  } finally {
    sandbox.cleanup();
  }
});
