/**
 * tests/functional/w3-consistency-watcher.functional.test.mjs —
 *
 * Drives lib/doctor/watchers/consistency.mjs against the live repo and against
 * isolated repo slices that use the Construct 2.0 registry layout
 * (registry/worker-profiles/ as the canonical registry layout). The watcher
 * is tested via the pure runAllChecks() entry so no audit/escalate side effects
 * leak into operator state. A second pair of tests spins up the real
 * `construct doctor consistency` CLI.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, mkdirSync,
} from 'node:fs';
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
  for (const dir of ['platforms/claude', 'lib/hooks', 'lib/mcp/tools', 'lib/contract-schemas']) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  // loadRegistry / checkRolesDrift / checkWorkerProfilePrompts / validateContractsFile
  // all read registry/worker-profiles + sibling catalogs — copy the real tree.
  cpSync(join(REPO_ROOT, 'registry'), join(root, 'registry'), { recursive: true });

  const validatorSrc = join(REPO_ROOT, 'lib', 'contracts', 'validate.mjs');
  if (existsSync(validatorSrc)) {
    mkdirSync(join(root, 'lib', 'contracts'), { recursive: true });
    cpSync(validatorSrc, join(root, 'lib', 'contracts', 'validate.mjs'));
  }
  if (existsSync(join(REPO_ROOT, 'lib', 'contract-schemas'))) {
    cpSync(join(REPO_ROOT, 'lib', 'contract-schemas'), join(root, 'lib', 'contract-schemas'), { recursive: true });
  }
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
  assert.equal(
    result.findings.filter((f) => f.category === 'prompt-files').length,
    0,
    'every Worker Profile id must resolve to registry/worker-profiles/prompts/<id>.md on disk',
  );
});

test('hooks-drift fires when a hook command points at a missing .mjs file', async () => {
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node "/abs/path/to/lib/hooks/nonexistent-hook.mjs"' }] }],
      },
    });

    const result = await runAllChecks({ repoRoot: slice.root });
    assert.ok(
      result.findings.some((f) => f.category === 'hooks-drift' && /nonexistent-hook\.mjs/.test(f.summary)),
      `expected hooks-drift finding for nonexistent-hook.mjs, got: ${JSON.stringify(result.findings, null, 2)}`,
    );
  } finally { slice.cleanup(); }
});

test('roles-drift does not flag a Worker Profile as ambiguous with itself', async () => {
  const result = await runAllChecks({ repoRoot: REPO_ROOT });
  const ambiguous = result.findings.filter(
    (f) => f.category === 'roles-drift' && /ambiguous/.test(f.summary),
  );
  assert.equal(
    ambiguous.length,
    0,
    `id/displayName of one Worker Profile must not read as ambiguous, got:\n${ambiguous.map((f) => '  - ' + f.summary).join('\n')}`,
  );
});

test('roles-drift fires when two profiles normalize to the same id', async () => {
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
    const architect = JSON.parse(readFileSync(join(slice.root, 'registry', 'worker-profiles', 'architect.json'), 'utf8'));
    slice.writeJson('registry/worker-profiles/cx-architect.json', {
      ...architect,
      id: 'cx-architect',
      displayName: 'collision fixture — normalizes to architect',
      description: 'collision fixture — normalizes to architect',
    });

    const result = await runAllChecks({ repoRoot: slice.root, skipRegistryValidation: true });
    assert.ok(
      result.findings.some((f) => f.category === 'roles-drift' && /ambiguous/.test(f.summary) && /architect/.test(f.summary)),
      `expected roles-drift ambiguity for architect, got:\n${JSON.stringify(result.findings.filter((f) => f.category === 'roles-drift'), null, 2)}`,
    );
  } finally { slice.cleanup(); }
});

test('prompt-files drift fires when a convention prompt is missing', async () => {
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
    const promptPath = join(slice.root, 'registry', 'worker-profiles', 'prompts', 'engineer.md');
    assert.ok(existsSync(promptPath), 'fixture must start with engineer prompt present');
    const { unlinkSync } = await import('node:fs');
    unlinkSync(promptPath);

    const result = await runAllChecks({ repoRoot: slice.root });
    assert.ok(
      result.findings.some(
        (f) => f.category === 'prompt-files' && /engineer\.md/.test(f.summary),
      ),
      `expected prompt-files finding for missing engineer.md, got:\n${JSON.stringify(result.findings.filter((f) => f.category === 'prompt-files'), null, 2)}`,
    );
  } finally { slice.cleanup(); }
});

test('contracts-drift fires when a contract schema path is missing', async (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'contracts', 'validate.mjs'))) {
    return t.skip('requires lib/contracts/validate.mjs');
  }
  const slice = freshRepoSlice();
  try {
    slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
    const capsPath = join(slice.root, 'registry', 'capabilities.json');
    const caps = JSON.parse(readFileSync(capsPath, 'utf8'));
    const first = caps.capabilities[0];
    assert.ok(first, 'expected at least one capability in the copied registry');
    first.contracts = first.contracts || {};
    first.contracts['bad-missing-schema'] = {
      id: 'bad-missing-schema',
      producer: 'architect',
      consumer: 'engineer',
      input: { shape: 'x' },
      output: { schema: 'lib/contract-schemas/does-not-exist-for-drift.json' },
    };
    writeFileSync(capsPath, JSON.stringify(caps, null, 2));

    const result = await runAllChecks({ repoRoot: slice.root });
    assert.ok(
      result.findings.some((f) => f.category === 'contracts-drift' && /does-not-exist-for-drift/.test(f.summary)),
      `expected contracts-drift finding for missing schema, got:\n${JSON.stringify(result.findings.filter((f) => f.category === 'contracts-drift'), null, 2)}`,
    );
  } finally { slice.cleanup(); }
});

test('clean tree reports zero mcp-drift', async () => {
  const result = await runAllChecks({ repoRoot: REPO_ROOT });
  const mcp = result.findings.filter((f) => f.category === 'mcp-drift');
  assert.equal(
    mcp.length, 0,
    `expected no mcp-drift on a clean tree, got:\n${mcp.map((f) => `  - ${f.summary}`).join('\n')}`,
  );
});

test('clean tree reports zero roles-drift', async () => {
  const result = await runAllChecks({ repoRoot: REPO_ROOT });
  const roles = result.findings.filter((f) => f.category === 'roles-drift');
  assert.equal(
    roles.length, 0,
    `expected no roles-drift on a clean tree, got:\n${roles.map((f) => `  - ${f.summary}`).join('\n')}`,
  );
});

function writeMcpSlice(slice, { serverBody, tools }) {
  slice.writeJson('platforms/claude/settings.template.json', { hooks: {} });
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
    env: { ...process.env, HOME: CLI_SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: CLI_SANDBOX_HOME },
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /clean/);
  assert.match(result.stdout, /0 warning\(s\)/);
});

test('construct doctor consistency --strict surfaces the internal tier', () => {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, 'bin', 'construct'), 'doctor', 'consistency', '--strict'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: CLI_SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: CLI_SANDBOX_HOME },
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /roles-drift/);
});
