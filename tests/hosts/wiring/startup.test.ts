import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURSOR_STARTUP, CURSOR_STARTUP_PATH, inspectStartup, installStartup } from '../../../src/hosts/wiring/startup.ts';
import { WIRABLE_CLIENTS } from '../../../src/hosts/wiring/clients.ts';
import { run } from '../../../src/cli/index.ts';
import { capture, sandbox } from '../../cli/support.ts';

test('every host init and dry run reports its startup surface without changing user instructions', async () => {
  for (const client of WIRABLE_CLIENTS) {
    const box = sandbox();
    try {
      writeFileSync(join(box.cwd, 'AGENTS.md'), 'Project-owned instructions.\n');
      const dry = await capture(() => run(['init', `--client=${client}`, '--dry-run', '--json'], box.ctx));
      assert.equal(dry.code, 0, dry.err);
      assert.equal(existsSync(join(box.cwd, CURSOR_STARTUP_PATH)), false);
      const init = await capture(() => run(['init', `--client=${client}`, '--json'], box.ctx));
      assert.equal(init.code, 0, init.err);
      const host = JSON.parse(init.out).hosts[0];
      assert.equal(host.startup?.status ?? null, client === 'cursor' ? 'installed' : null);
      assert.equal(readFileSync(join(box.cwd, 'AGENTS.md'), 'utf8'), 'Project-owned instructions.\n');
      if (client === 'cursor') {
        const health = JSON.parse((await capture(() => run(['doctor', '--json'], box.ctx))).out);
        assert.equal(health.checks.find((c: { name: string }) => c.name === 'host-startup:cursor').ok, true);
        assert.match(readFileSync(join(box.cwd, CURSOR_STARTUP_PATH), 'utf8'), /alwaysApply: true/);
        assert.match(host.startup.detail, /not enforced/);
      }
    } finally { box.cleanup(); }
  }
});

test('no-wire plants no startup rule and repeated init preserves project edits with a diagnostic', async () => {
  const box = sandbox();
  try {
    assert.equal((await capture(() => run(['init', '--client=cursor', '--no-wire'], box.ctx))).code, 0);
    assert.equal(existsSync(join(box.cwd, CURSOR_STARTUP_PATH)), false);
    assert.equal(installStartup('cursor', box.cwd)?.status, 'installed');
    assert.equal(installStartup('cursor', box.cwd)?.status, 'installed');
    const edited = CURSOR_STARTUP + '\nUser-owned amendment.\n';
    writeFileSync(join(box.cwd, CURSOR_STARTUP_PATH), edited);
    const init = await capture(() => run(['init', '--client=cursor', '--json'], box.ctx));
    assert.equal(JSON.parse(init.out).hosts[0].startup.status, 'diverged');
    assert.equal(readFileSync(join(box.cwd, CURSOR_STARTUP_PATH), 'utf8'), edited);
    const health = JSON.parse((await capture(() => run(['doctor', '--json'], box.ctx))).out);
    assert.equal(health.checks.find((c: { name: string }) => c.name === 'host-startup:cursor').ok, false);
  } finally { box.cleanup(); }
});

test('startup installation refuses symlinked directories and files without changing the target', () => {
  for (const targetKind of ['directory', 'file']) {
    const box = sandbox();
    try {
      const target = join(box.home, 'owned');
      if (targetKind === 'directory') {
        mkdirSync(target); symlinkSync(target, join(box.cwd, '.cursor'));
      } else {
        mkdirSync(join(box.cwd, '.cursor/rules'), { recursive: true });
        writeFileSync(target, 'owned'); symlinkSync(target, join(box.cwd, CURSOR_STARTUP_PATH));
      }
      assert.equal(installStartup('cursor', box.cwd)?.status, 'broken');
      assert.equal(inspectStartup('cursor', box.cwd)?.status, 'broken');
      if (targetKind === 'file') assert.equal(readFileSync(target, 'utf8'), 'owned');
      else assert.equal(existsSync(join(target, 'rules')), false);
    } finally { box.cleanup(); }
  }
});
