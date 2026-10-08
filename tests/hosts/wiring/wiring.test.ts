/**
 * tests/hosts/wiring/wiring.test.ts — each supported host's project MCP file
 * gains a construct entry that starts serve for that host with no machine
 * path in it, other entries survive, and a malformed file is reported rather
 * than clobbered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { CLIENT_WIRINGS, normalizeClient, parseClients, serveArgs, WIRABLE_CLIENTS } from '../../../src/hosts/wiring/clients.ts';
import { installWiring, inspectWiring, launchOf } from '../../../src/hosts/wiring/wire.ts';
import { readTomlServerTable } from '../../../src/hosts/wiring/merge-toml.ts';
import { run } from '../../../src/cli/index.ts';
import { capture, sandbox } from '../../cli/support.ts';

const DOCUMENTED_FILES: Record<string, string> = {
  'claude-code': '.mcp.json',
  cursor: join('.cursor', 'mcp.json'),
  vscode: join('.vscode', 'mcp.json'),
  opencode: 'opencode.json',
  codex: join('.codex', 'config.toml'),
  bob: join('.bob', 'mcp.json'),
};

function writtenEntry(w: (typeof CLIENT_WIRINGS)[number], path: string): Record<string, unknown> {
  if (w.format === 'toml') return readTomlServerTable(path, 'construct')!;
  const file = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
  return file[w.serversKey]!.construct!;
}

test('every wirable client writes its documented file with a portable serve entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-wiring-'));
  try {
    assert.deepEqual([...WIRABLE_CLIENTS].sort(), Object.keys(DOCUMENTED_FILES).sort());
    for (const w of CLIENT_WIRINGS) {
      assert.equal(w.relativePath, DOCUMENTED_FILES[w.id], `${w.id} writes the file its host documents`);
      assert.equal(inspectWiring(w.id, root).status, 'absent');
      const state = installWiring(w.id, root);
      assert.equal(state.status, 'installed', `${w.id}: ${state.detail}`);
      assert.equal(state.path, join(root, w.relativePath));
      const entry = writtenEntry(w, state.path);
      const launch = launchOf(w.id, root)!;
      const parts = [launch.command, ...launch.args];
      assert.ok(['construct', 'npx'].includes(launch.command), `${w.id} starts construct or npx, not ${launch.command}`);
      assert.ok(parts.includes('serve'), `${w.id} starts serve`);
      assert.ok(parts.includes(`--client=${w.id}`), `${w.id} binds its client`);
      assert.ok(!parts.some((p) => /^--project=\//.test(p)), `${w.id} names no absolute project`);
      assert.ok(!parts.some((p) => isAbsolute(p)), `${w.id} carries no absolute path: ${parts.join(' ')}`);
      assert.ok(!parts.some((p) => p.endsWith('bin/construct.mjs')), `${w.id} names no launcher script`);
      assert.ok(!JSON.stringify(entry).includes(root), `${w.id} carries no project path`);
      assert.match(w.documentation, /^https:\/\//);
      assert.equal(installWiring(w.id, root).status, 'installed', 'idempotent');
    }
    assert.deepEqual(serveArgs('cursor'), ['serve', '--client=cursor']);
    assert.equal(normalizeClient('claude'), 'claude-code');
    assert.equal(normalizeClient('nope'), 'unknown');
    assert.deepEqual(parseClients(['claude,cursor', 'codex', 'claude-code', 'nope']), { clients: ['claude-code', 'cursor', 'codex'], unknown: ['nope'] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a legacy-named construct serve entry is rewritten to the canonical name', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-wiring-'));
  try {
    mkdirSync(join(root, '.cursor'));
    writeFileSync(
      join(root, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          'construct-mcp': { command: 'node', args: ['/pkg/bin/construct.mjs', 'serve'] },
          other: { command: 'x' },
        },
      }),
      'utf8',
    );
    const state = installWiring('cursor', root);
    assert.equal(state.status, 'installed');
    assert.match(state.detail, /replaced duplicate construct-mcp/);
    const file = JSON.parse(readFileSync(state.path, 'utf8')) as { mcpServers: Record<string, { args?: string[] }> };
    assert.deepEqual(Object.keys(file.mcpServers).sort(), ['construct', 'other']);
    assert.ok(file.mcpServers.construct!.args?.includes('--project=${workspaceFolder}'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('other servers in the file survive; a malformed file is reported, not overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-wiring-'));
  try {
    mkdirSync(join(root, '.cursor'));
    writeFileSync(join(root, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }), 'utf8');
    const state = installWiring('cursor', root);
    assert.equal(state.status, 'installed');
    const file = JSON.parse(readFileSync(state.path, 'utf8')) as { mcpServers: Record<string, unknown> };
    assert.deepEqual(Object.keys(file.mcpServers).sort(), ['construct', 'other']);
    writeFileSync(join(root, '.mcp.json'), '{ not json', 'utf8');
    const broken = installWiring('claude-code', root);
    assert.equal(broken.status, 'broken');
    assert.match(broken.detail, /not valid JSON/);
    assert.equal(readFileSync(join(root, '.mcp.json'), 'utf8'), '{ not json');
    writeFileSync(join(root, '.vscode.json'), '', 'utf8');
    mkdirSync(join(root, '.vscode'));
    writeFileSync(join(root, '.vscode', 'mcp.json'), JSON.stringify({ servers: { construct: { command: 'node', args: ['serve'] } } }), 'utf8');
    assert.equal(inspectWiring('vscode', root).status, 'broken');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('init --client wires the host, doctor reports it, and serve --describe names the surface', async () => {
  const box = sandbox();
  try {
    const init = await capture(() => run(['init', '--client=cursor', '--scale=solo', '--outcome=x', '--constraint=y', `--skills-dir=${join(box.home, 'skills')}`, '--json'], box.ctx));
    assert.equal(init.code, 0, init.err);
    const record = JSON.parse(init.out) as { hosts: { client: string; mcp: { path: string; status: string; launch: string }; skill: { dir: string } }[] };
    // The sandbox PATH holds this checkout's launcher as `construct`, which is what the cursor entry starts.
    assert.equal(record.hosts[0]!.client, 'cursor');
    assert.deepEqual({ path: record.hosts[0]!.mcp.path, status: record.hosts[0]!.mcp.status, launch: record.hosts[0]!.mcp.launch }, { path: join(box.cwd, '.cursor', 'mcp.json'), status: 'installed', launch: 'construct' });
    assert.equal(record.hosts[0]!.skill.dir, join(box.cwd, '.agents', 'skills'));
    const doctor = await capture(() => run(['doctor', '--json'], box.ctx));
    const checks = (JSON.parse(doctor.out) as { checks: { name: string; ok: boolean; detail: string }[] }).checks;
    assert.match(checks.find((c) => c.name === 'host-wiring')!.detail, /cursor installed/);
    const launch = checks.find((c) => c.name === 'host-launch:cursor')!;
    assert.equal(launch.ok, true, launch.detail);
    assert.match(launch.detail, /the same install as this doctor.*a host started from the Dock may see another/);
    assert.equal((JSON.parse(doctor.out) as { healthy: boolean }).healthy, true, doctor.out);
    const describe = await capture(() => run(['serve', '--client=cursor', '--describe'], box.ctx));
    assert.equal(describe.code, 0, describe.err);
    assert.match(describe.out, /would serve the interactive surface for cursor/);
    const headless = await capture(() => run(['serve', '--headless', '--executor=runner:ci', '--json'], box.ctx));
    assert.equal(JSON.parse(headless.out).surface, 'headless');
    assert.equal(JSON.parse(headless.out).maxTier, 'project_write');
    const noWire = await capture(() => run(['init', '--client=cursor', '--no-wire', `--skills-dir=${join(box.home, 'skills')}`], box.ctx));
    assert.match(noWire.out, /no MCP configuration written \(--no-wire\)/);
  } finally {
    box.cleanup();
  }
});
