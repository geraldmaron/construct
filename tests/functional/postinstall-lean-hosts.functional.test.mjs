/**
 * tests/functional/postinstall-lean-hosts.functional.test.mjs
 *
 * construct-w4hly: consumer npm postinstall must not stage every PATH-detected
 * host. With stub claude/codex/opencode/code on PATH, a fresh project still
 * gets only `.claude/` (+ `.construct/`). Re-postinstall preserves an already
 * marked secondary host (Codex).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSTINSTALL = join(REPO_ROOT, 'bin', 'construct-postinstall.mjs');

function writeStubBin(binDir, name, versionLine = `${name} 0.0.0-test`) {
  const path = join(binDir, name);
  writeFileSync(path, `#!/bin/sh\necho '${versionLine}'\n`);
  chmodSync(path, 0o755);
}

function makeConsumer({ withCodexMarker = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cx-postinstall-lean-'));
  const home = mkdtempSync(join(tmpdir(), 'cx-postinstall-lean-home-'));
  const binDir = mkdtempSync(join(tmpdir(), 'cx-postinstall-lean-bin-'));
  const project = join(root, 'consumer');
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify({ name: 'lean-host-consumer', version: '0.0.0' }),
  );
  writeStubBin(binDir, 'claude', '2.1.40 (Claude Code)');
  writeStubBin(binDir, 'codex', 'codex-cli 0.0.0');
  writeStubBin(binDir, 'opencode', 'opencode 0.0.0');
  writeStubBin(binDir, 'code', '1.0.0');
  if (withCodexMarker) {
    mkdirSync(join(project, '.codex', 'agents'), { recursive: true });
    writeFileSync(join(project, '.codex', 'agents', 'construct.toml'), '# pre-existing\n');
  }
  return { root, home, binDir, project };
}

function runPostinstall({ project, home, binDir, envExtra = {} }) {
  return spawnSync(process.execPath, [POSTINSTALL], {
    cwd: project,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      INIT_CWD: project,
      HOME: home,
      CONSTRUCT_HOME_OVERRIDE: home,
      CONSTRUCT_SKIP_POSTINSTALL: '',
      PATH: `${binDir}:${process.env.PATH || ''}`,
      ...envExtra,
    },
  });
}

test('postinstall stages only Claude adapters when many host CLIs are on PATH', (t) => {
  const ctx = makeConsumer();
  t.after(() => {
    rmTmpDir(ctx.root);
    rmTmpDir(ctx.home);
    rmTmpDir(ctx.binDir);
  });

  const result = runPostinstall(ctx);
  assert.equal(result.status, 0, `postinstall exit ${result.status}: ${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /lean bootstrap hosts: claude\b/);
  assert.ok(existsSync(join(ctx.project, '.construct', 'launcher', 'run.mjs')));
  assert.ok(existsSync(join(ctx.project, '.claude', 'settings.json')));
  assert.ok(!existsSync(join(ctx.project, '.codex')), 'must not stage .codex from PATH alone');
  assert.ok(!existsSync(join(ctx.project, '.opencode')), 'must not stage .opencode from PATH alone');
  assert.ok(!existsSync(join(ctx.project, '.vscode')), 'must not stage .vscode from PATH alone');
  assert.ok(!existsSync(join(ctx.project, '.cursor')), 'must not stage .cursor from PATH alone');
});

test('postinstall preserves an already-marked Codex adapter on re-run', (t) => {
  const ctx = makeConsumer({ withCodexMarker: true });
  t.after(() => {
    rmTmpDir(ctx.root);
    rmTmpDir(ctx.home);
    rmTmpDir(ctx.binDir);
  });

  const result = runPostinstall(ctx);
  assert.equal(result.status, 0, `postinstall exit ${result.status}: ${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /lean bootstrap hosts: claude, codex\b/);
  assert.ok(existsSync(join(ctx.project, '.claude', 'settings.json')));
  assert.ok(existsSync(join(ctx.project, '.codex', 'agents', 'construct.toml')));
  assert.ok(!existsSync(join(ctx.project, '.opencode')), 'PATH-only OpenCode must stay unsynced');
  assert.ok(!existsSync(join(ctx.project, '.vscode')), 'PATH-only VS Code must stay unsynced');
});

test('CONSTRUCT_SYNC_HOSTS=all restores multi-host postinstall opt-in', (t) => {
  const ctx = makeConsumer();
  t.after(() => {
    rmTmpDir(ctx.root);
    rmTmpDir(ctx.home);
    rmTmpDir(ctx.binDir);
  });

  const result = runPostinstall({ ...ctx, envExtra: { CONSTRUCT_SYNC_HOSTS: 'all' } });
  assert.equal(result.status, 0, `postinstall exit ${result.status}: ${result.stderr}\n${result.stdout}`);
  assert.ok(existsSync(join(ctx.project, '.claude', 'settings.json')));
  assert.ok(existsSync(join(ctx.project, '.codex', 'agents')));
  assert.ok(existsSync(join(ctx.project, '.opencode')));
  assert.ok(existsSync(join(ctx.project, '.vscode')));
});
