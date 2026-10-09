/**
 * tests/hosts/wiring/launch.test.ts — a host file starts the project's own
 * dependency through npx when this install is one, and `construct` from the
 * PATH otherwise; rewriting an unchanged file leaves it alone; and an entry
 * that pins another machine's paths reads as broken until init rewrites it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIENT_WIRINGS, launchFor, LAUNCHER } from '../../../src/hosts/wiring/clients.ts';
import { installWiring, inspectWiring, launchOf } from '../../../src/hosts/wiring/wire.ts';

function scratch(fn: (root: string) => void): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'construct-launch-')));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('launchFor starts the project dependency through npx, and construct from PATH otherwise', () => {
  scratch((root) => {
    const installed = join(root, 'node_modules', '@geraldmaron', 'construct', 'bin');
    mkdirSync(installed, { recursive: true });
    writeFileSync(join(installed, 'construct.mjs'), '', 'utf8');
    assert.deepEqual(launchFor(root, join(installed, 'construct.mjs')), { command: 'npx', args: ['--no-install', 'construct'], form: 'project-dependency' });
    assert.deepEqual(launchFor(root, LAUNCHER), { command: 'construct', args: [], form: 'path' });
    assert.deepEqual(launchFor(join(root, 'elsewhere'), join(installed, 'construct.mjs')), { command: 'construct', args: [], form: 'path' }, 'another project’s dependency is not this one’s');
    // A launcher reached through a symlink into node_modules is still the project's dependency.
    mkdirSync(join(root, 'link'), { recursive: true });
    symlinkSync(join(installed, 'construct.mjs'), join(root, 'link', 'construct'));
    assert.equal(launchFor(root, join(root, 'link', 'construct')).form, 'project-dependency');
  });
});

test('re-installing every host leaves its file’s bytes and modification time unchanged', () => {
  scratch((root) => {
    for (const w of CLIENT_WIRINGS) {
      assert.equal(installWiring(w.id, root).status, 'installed');
      const path = join(root, w.relativePath);
      const bytes = readFileSync(path);
      const mtime = statSync(path).mtimeMs;
      const again = installWiring(w.id, root);
      assert.equal(again.status, 'installed', `${w.id}: ${again.detail}`);
      assert.ok(readFileSync(path).equals(bytes), `${w.id} bytes unchanged`);
      assert.equal(statSync(path).mtimeMs, mtime, `${w.id} not rewritten`);
    }
  });
});

test('an entry pinned to another machine’s Node and launcher is broken, names the repair, and install replaces it', () => {
  scratch((root) => {
    const pinned = {
      mcpServers: {
        construct: {
          type: 'stdio',
          command: '/nonexistent/.local/share/fnm/node-versions/v22.18.0/installation/bin/node',
          args: ['/nonexistent/lib/node_modules/@geraldmaron/construct/bin/construct.mjs', 'serve', '--client=claude-code', `--project=${root}`],
        },
        other: { command: 'x' },
      },
    };
    writeFileSync(join(root, '.mcp.json'), JSON.stringify(pinned, null, 2), 'utf8');
    const broken = inspectWiring('claude-code', root);
    assert.equal(broken.status, 'broken');
    assert.match(broken.detail, /starts \/nonexistent\/.*node, which no longer exists \(another machine's path or an old Node\); `construct init --client=claude-code` rewrites it/);
    const fixed = installWiring('claude-code', root);
    assert.equal(fixed.status, 'installed', fixed.detail);
    assert.deepEqual(launchOf('claude-code', root), { command: 'construct', args: ['serve', '--client=claude-code'] });
    const file = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> };
    assert.deepEqual(file.mcpServers.other, { command: 'x' }, 'the other server is kept');

    // Only the launcher gone, with a Node that exists: still broken, naming the launcher.
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { construct: { command: process.execPath, args: ['/nonexistent/bin/construct.mjs', 'serve', '--client=claude-code'] } } }), 'utf8');
    assert.match(inspectWiring('claude-code', root).detail, /starts \/nonexistent\/bin\/construct\.mjs, which no longer exists/);

    // Paths that exist here still work here, and the detail says they work nowhere else.
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { construct: { command: process.execPath, args: [LAUNCHER, 'serve', '--client=claude-code'] } } }), 'utf8');
    const local = inspectWiring('claude-code', root);
    assert.equal(local.status, 'installed');
    assert.match(local.detail, /a path on this machine only; `construct init --client=claude-code` writes one that works on any machine/);
  });
});
