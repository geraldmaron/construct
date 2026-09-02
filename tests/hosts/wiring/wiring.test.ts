/**
 * tests/hosts/wiring/wiring.test.ts — each supported host's project MCP file
 * gains a construct entry that launches serve bound to this project, other
 * entries survive, and a malformed file is reported rather than clobbered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIENT_WIRINGS, normalizeClient, serveArgs } from '../../../src/hosts/wiring/clients.ts';
import { installWiring, inspectWiring } from '../../../src/hosts/wiring/wire.ts';
import { run } from '../../../src/cli/index.ts';
import { capture, sandbox } from '../../cli/support.ts';

test('every wirable client writes its documented file with a bound serve entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-wiring-'));
  try {
    for (const w of CLIENT_WIRINGS) {
      assert.equal(inspectWiring(w.id, root).status, 'absent');
      const state = installWiring(w.id, root);
      assert.equal(state.status, 'installed', `${w.id}: ${state.detail}`);
      assert.equal(state.path, join(root, w.relativePath));
      const file = JSON.parse(readFileSync(state.path, 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
      const entry = file[w.serversKey]!.construct!;
      const args = (Array.isArray(entry.args) ? entry.args : (entry.command as string[])).map(String);
      assert.ok(args.includes(`--client=${w.id}`), `${w.id} binds its client`);
      assert.ok(args.includes(`--project=${root}`), `${w.id} binds the project`);
      assert.ok(args.some((a) => a.endsWith('bin/construct.mjs')));
      assert.match(w.documentation, /^https:\/\//);
      assert.equal(installWiring(w.id, root).status, 'installed', 'idempotent');
    }
    assert.deepEqual(serveArgs('cursor', '/p').slice(1), ['serve', '--client=cursor', '--project=/p']);
    assert.equal(normalizeClient('claude'), 'claude-code');
    assert.equal(normalizeClient('nope'), 'unknown');
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
    const record = JSON.parse(init.out) as { hostWiring: { client: string; status: string } };
    assert.deepEqual(record.hostWiring, { client: 'cursor', path: join(box.cwd, '.cursor', 'mcp.json'), status: 'installed' });
    const doctor = await capture(() => run(['doctor', '--json'], box.ctx));
    const checks = (JSON.parse(doctor.out) as { checks: { name: string; ok: boolean; detail: string }[] }).checks;
    assert.match(checks.find((c) => c.name === 'host-wiring')!.detail, /cursor installed/);
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
