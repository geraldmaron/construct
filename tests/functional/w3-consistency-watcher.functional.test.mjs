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
import { mkdtempSync, cpSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { runAllChecks } from '../../lib/doctor/watchers/consistency.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CLI_SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'w3-consistency-cli-home-'));
after(() => rmTmpDir(CLI_SANDBOX_HOME));

function freshRepoSlice() {
  const root = mkdtempSync(join(tmpdir(), 'construct-consistency-'));
  for (const dir of ['platforms/claude', 'lib/hooks', 'lib/mcp/tools', 'lib/contract-schemas', 'specialists']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  // W2's contract validator + schema are optional dependencies for the
  // contracts-drift check; only copy them when they exist on this branch.
  const validatorSrc = join(REPO_ROOT, 'lib', 'contracts', 'validate.mjs');
  if (existsSync(validatorSrc)) {
    mkdirSync(join(root, 'lib', 'contracts'), { recursive: true });
    cpSync(validatorSrc, join(root, 'lib', 'contracts', 'validate.mjs'));
  }
  const contractsSchemaSrc = join(REPO_ROOT, 'specialists', 'contracts.schema.json');
  if (existsSync(contractsSchemaSrc)) cpSync(contractsSchemaSrc, join(root, 'agents', 'contracts.schema.json'));
  cpSync(join(REPO_ROOT, 'lib', 'contract-schemas'), join(root, 'lib', 'contract-schemas'), { recursive: true });
  return {
    root,
    cleanup() { try { rmTmpDir(root); } catch { /* ignore */ } },
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
    slice.writeJson('specialists/org', { specialists: [], orchestrator: null });
    slice.writeJson('specialists/contracts.json', {
      version: 1,
      terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] },
      contracts: [],
    });
    slice.writeJson('specialists/role-manifests.json', {});

    const result = await runAllChecks({ repoRoot: slice.root });
    assert.ok(
      result.findings.some((f) => f.category === 'hooks-drift' && /nonexistent-hook\.mjs/.test(f.summary)),
      `expected hooks-drift finding for nonexistent-hook.mjs, got: ${JSON.stringify(result.findings, null, 2)}`,
    );
  } finally { slice.cleanup(); }
});

test('roles-drift fires when normalized persona ids collide', async () => {
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
    slice.writeJson('specialists/org', {
      orchestrator: { name: 'imaginary' },
      specialists: {
        'cx-imaginary': { name: 'imaginary', promptFile: 'specialists/prompts/imaginary.md' },
      },
    });
    slice.writeJson('specialists/contracts.json', {
      version: 1, terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] }, contracts: [],
    });

    const result = await runAllChecks({ repoRoot: slice.root });
    assert.ok(
      result.findings.some((f) => f.category === 'roles-drift' && /imaginary/.test(f.summary) && /ambiguous/.test(f.summary)),
      'expected roles-drift finding for ambiguous normalized persona id',
    );
  } finally { slice.cleanup(); }
});

test('prompt-files fires when a persona promptFile is missing on disk', async () => {
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
    slice.writeJson('specialists/org', {
      orchestrator: { name: 'fake', promptFile: 'specialists/prompts/never-existed.md' },
      specialists: [],
    });
    slice.writeJson('specialists/role-manifests.json', {});
    slice.writeJson('specialists/contracts.json', {
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
    slice.writeJson('specialists/org', {
      orchestrator: { name: 'construct' },
      specialists: [{ name: 'architect' }],
    });
    slice.writeJson('specialists/role-manifests.json', {});
    slice.writeJson('specialists/contracts.json', {
      version: 1, terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] },
      contracts: [{
        id: 'bad', producer: 'cx-unresolvable', consumer: 'architect',
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

// A clean install must produce zero non-actionable warnings. The package-internal
// drift families (mcp-drift, roles-drift) were both firing false positives — a
// specialist's id self-colliding with its own name, and the xxxTool→'xxx' naming
// convention reading as undispatched. Guard both at source.

test('clean tree reports zero mcp-drift and zero roles-drift', async () => {
  const result = await runAllChecks({ repoRoot: REPO_ROOT });
  const internal = result.findings.filter((f) => f.category === 'mcp-drift' || f.category === 'roles-drift');
  assert.equal(
    internal.length, 0,
    `expected no package-internal drift on a clean tree, got:\n${internal.map((f) => `  - [${f.category}] ${f.summary}`).join('\n')}`,
  );
});

test('roles-drift does not fire when a specialist id and its own name normalize together', async () => {
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
    slice.writeJson('specialists/org', {
      orchestrator: { id: 'cx-construct', name: 'construct' },
      specialists: {
        'architect': { name: 'architect' },
        'engineer': { name: 'engineer' },
      },
    });
    slice.writeJson('specialists/contracts.json', {
      version: 1, terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] }, contracts: [],
    });

    const result = await runAllChecks({ repoRoot: slice.root });
    const rolesDrift = result.findings.filter((f) => f.category === 'roles-drift');
    assert.equal(
      rolesDrift.length, 0,
      `id/name pairs of one specialist must not read as ambiguous, got:\n${rolesDrift.map((f) => '  - ' + f.summary).join('\n')}`,
    );
  } finally { slice.cleanup(); }
});

function writeMcpSlice(slice, { serverBody, tools }) {
  slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
  slice.writeJson('specialists/org', { specialists: [], orchestrator: null });
  slice.writeJson('specialists/contracts.json', {
    version: 1, terminalStates: ['DONE'],
    severities: { blocking: [], warning: [], info: [] }, contracts: [],
  });
  mkdirSync(join(slice.root, 'lib', 'mcp', 'tools'), { recursive: true });
  for (const [name, body] of Object.entries(tools)) slice.write(join('lib', 'mcp', 'tools', name), body);
  slice.write(join('lib', 'mcp', 'server.mjs'), serverBody);
}

test('mcp-drift fires when a server-imported handler is never dispatched', async () => {
  const slice = freshRepoSlice();
  try {
    writeMcpSlice(slice, {
      tools: { 'widget.mjs': 'export function orphanWidget(args){ return args; }\n' },
      serverBody:
        "import { orphanWidget } from './tools/widget.mjs';\n" +
        'export async function dispatchToolByName(name, args){\n' +
        "  if (name === 'noop') return args;\n" +
        '  return undefined;\n' +
        '}\n',
    });
    const result = await runAllChecks({ repoRoot: slice.root });
    assert.ok(
      result.findings.some((f) => f.category === 'mcp-drift' && /orphanWidget/.test(f.summary)),
      `expected mcp-drift for orphanWidget, got:\n${JSON.stringify(result.findings.filter((f) => f.category === 'mcp-drift'), null, 2)}`,
    );
  } finally { slice.cleanup(); }
});

test('mcp-drift ignores tool-module helpers the server never imports', async () => {
  const slice = freshRepoSlice();
  try {
    writeMcpSlice(slice, {
      tools: { 'widget.mjs': 'export function exec(cmd){ return cmd; }\nexport function widgetTool(args){ return args; }\n' },
      serverBody:
        "import { widgetTool } from './tools/widget.mjs';\n" +
        'export async function dispatchToolByName(name, args){\n' +
        "  if (name === 'widget') return widgetTool(args);\n" +
        '  return undefined;\n' +
        '}\n',
    });
    const result = await runAllChecks({ repoRoot: slice.root });
    const mcp = result.findings.filter((f) => f.category === 'mcp-drift');
    assert.equal(
      mcp.length, 0,
      `exec is an unimported helper and widgetTool is dispatched; expected no mcp-drift, got:\n${mcp.map((f) => '  - ' + f.summary).join('\n')}`,
    );
  } finally { slice.cleanup(); }
});

test('construct doctor consistency CLI exits 0 and is clean by default', () => {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, 'bin', 'construct'), 'doctor', 'consistency'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CONSTRUCT_SKIP_PROMPT_LOOKUP: '1', HOME: CLI_SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: CLI_SANDBOX_HOME },
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /clean/);
  assert.match(result.stdout, /0 warning\(s\)/);
});

test('construct doctor consistency --strict surfaces the internal tier', () => {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, 'bin', 'construct'), 'doctor', 'consistency', '--strict'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CONSTRUCT_SKIP_PROMPT_LOOKUP: '1', HOME: CLI_SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: CLI_SANDBOX_HOME },
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /mcp-drift/);
  assert.match(result.stdout, /roles-drift/);
});
