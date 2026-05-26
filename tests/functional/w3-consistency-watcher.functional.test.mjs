/**
 * tests/functional/w3-consistency-watcher.functional.test.mjs —
 *
 * Drives lib/doctor/watchers/consistency.mjs against the live repo to verify
 * each cross-surface check fires when state actually drifts. The watcher is
 * tested via the pure runAllChecks() entry so no audit/escalate side effects
 * leak into operator state. A second test spins up the real `construct doctor
 * consistency` CLI to make sure the user-facing command exits 0 on a clean
 * tree.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

import { runAllChecks } from '../../lib/doctor/watchers/consistency.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshRepoSlice() {
  const root = mkdtempSync(join(tmpdir(), 'construct-consistency-'));
  for (const dir of ['platforms/claude', 'lib/hooks', 'lib/mcp/tools', 'lib/schemas', 'agents']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  // W2's contract validator + schema are optional dependencies for the
  // contracts-drift check; only copy them when they exist on this branch.
  const validatorSrc = join(REPO_ROOT, 'lib', 'contracts', 'validate.mjs');
  if (existsSync(validatorSrc)) {
    mkdirSync(join(root, 'lib', 'contracts'), { recursive: true });
    cpSync(validatorSrc, join(root, 'lib', 'contracts', 'validate.mjs'));
  }
  const contractsSchemaSrc = join(REPO_ROOT, 'agents', 'contracts.schema.json');
  if (existsSync(contractsSchemaSrc)) cpSync(contractsSchemaSrc, join(root, 'agents', 'contracts.schema.json'));
  cpSync(join(REPO_ROOT, 'lib', 'schemas'), join(root, 'lib', 'schemas'), { recursive: true });
  return {
    root,
    cleanup() { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } },
    writeJson(rel, obj) { writeFileSync(join(root, rel), JSON.stringify(obj, null, 2)); },
    write(rel, body) { writeFileSync(join(root, rel), body); },
  };
}

test('runAllChecks against the live repo: contracts and prompt-files are clean', async () => {
  const result = await runAllChecks({ repoRoot: REPO_ROOT });
  const blocking = result.findings.filter((f) => f.severity === 'blocking');
  assert.equal(blocking.length, 0, `expected no blocking findings, got:\n${blocking.map((f) => '  - ' + f.summary).join('\n')}`);
  assert.ok(result.passed.length >= 1, 'expected at least one passing category');
});

test('hooks-drift fires when a hook command points at a missing .mjs file', async () => {
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node "/abs/path/to/lib/hooks/nonexistent-hook.mjs"' }] }],
      },
    });
    slice.writeJson('agents/registry.json', { agents: [], personas: [] });
    slice.writeJson('agents/contracts.json', {
      version: 1,
      terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] },
      contracts: [],
    });
    slice.writeJson('agents/role-manifests.json', {});

    const result = await runAllChecks({ repoRoot: slice.root });
    assert.ok(
      result.findings.some((f) => f.category === 'hooks-drift' && /nonexistent-hook\.mjs/.test(f.summary)),
      `expected hooks-drift finding for nonexistent-hook.mjs, got: ${JSON.stringify(result.findings, null, 2)}`,
    );
  } finally { slice.cleanup(); }
});

test('roles-drift fires when role-manifests references a persona not in registry', async () => {
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
    slice.writeJson('agents/registry.json', {
      personas: [{ name: 'construct' }],
      agents: [{ name: 'architect' }],
    });
    slice.writeJson('agents/role-manifests.json', {
      'cx-imaginary': { events: [] },
    });
    slice.writeJson('agents/contracts.json', {
      version: 1, terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] }, contracts: [],
    });

    const result = await runAllChecks({ repoRoot: slice.root });
    assert.ok(
      result.findings.some((f) => f.category === 'roles-drift' && /cx-imaginary/.test(f.summary)),
      'expected roles-drift finding for cx-imaginary',
    );
  } finally { slice.cleanup(); }
});

test('prompt-files fires when a persona promptFile is missing on disk', async () => {
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
    slice.writeJson('agents/registry.json', {
      personas: [{ name: 'fake', promptFile: 'agents/prompts/never-existed.md' }],
      agents: [],
    });
    slice.writeJson('agents/role-manifests.json', {});
    slice.writeJson('agents/contracts.json', {
      version: 1, terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] }, contracts: [],
    });

    const result = await runAllChecks({ repoRoot: slice.root });
    const blockingPromptFinding = result.findings.find(
      (f) => f.category === 'prompt-files' && f.severity === 'blocking' && /never-existed\.md/.test(f.summary),
    );
    assert.ok(blockingPromptFinding, 'expected blocking prompt-files finding');
  } finally { slice.cleanup(); }
});

test('contracts-drift fires when contracts reference an unresolvable producer', async (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'contracts', 'validate.mjs'))) {
    return t.skip('requires lib/contracts/validate.mjs from W2');
  }
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
    slice.writeJson('agents/registry.json', {
      personas: [{ name: 'construct' }],
      agents: [{ name: 'architect' }],
    });
    slice.writeJson('agents/role-manifests.json', {});
    slice.writeJson('agents/contracts.json', {
      version: 1, terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] },
      contracts: [{
        id: 'bad', producer: 'cx-unresolvable', consumer: 'cx-architect',
        input: { shape: 'x' },
      }],
    });

    const result = await runAllChecks({ repoRoot: slice.root });
    assert.ok(
      result.findings.some((f) => f.category === 'contracts-drift' && /cx-unresolvable/.test(f.summary)),
      'expected contracts-drift finding for cx-unresolvable',
    );
  } finally { slice.cleanup(); }
});

test('construct doctor consistency CLI exits 0 on a clean tree', () => {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, 'bin', 'construct'), 'doctor', 'consistency'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CONSTRUCT_SKIP_PROMPT_LOOKUP: '1' },
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /clean/);
});
