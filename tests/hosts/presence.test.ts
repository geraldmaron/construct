/**
 * tests/hosts/presence.test.ts — an agent host is present when one of its
 * commands is on PATH or its configuration directory exists, and each finding
 * says what showed it. Every PATH and HOME here is a scratch directory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sterile } from '../harness/sterile.ts';
import { findOnPath, presentHosts } from '../../src/hosts/presence.ts';
import { resolveHostConfigDirs } from '../../src/kernel/paths.ts';

function executable(dir: string, name: string, mode = 0o755): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, '#!/bin/sh\n', { mode });
  return path;
}

test('a host command on PATH is found, with the path as its evidence', () => {
  const fx = sterile();
  try {
    const bin = join(fx.root, 'bin');
    const claude = executable(bin, 'claude');
    const home = join(fx.root, 'home');
    mkdirSync(home);
    const env = { PATH: bin, HOME: home };
    assert.deepEqual(presentHosts(env, resolveHostConfigDirs(env)), [{ client: 'claude-code', evidence: `claude on PATH (${claude})` }]);
    executable(bin, 'cursor-agent');
    assert.deepEqual(presentHosts(env, resolveHostConfigDirs(env)).map((h) => h.client), ['claude-code', 'cursor']);
  } finally {
    fx.cleanup();
  }
});

test('a configuration directory in HOME is found, and CODEX_HOME is where Codex keeps its own', () => {
  const fx = sterile();
  try {
    const home = join(fx.root, 'home');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const env: NodeJS.ProcessEnv = { PATH: join(fx.root, 'no-bin'), HOME: home };
    assert.deepEqual(presentHosts(env, resolveHostConfigDirs(env)), [{ client: 'cursor', evidence: `found ${join(home, '.cursor')}` }]);

    const codexHome = join(fx.root, 'codex-config');
    mkdirSync(codexHome);
    const withCodex = { ...env, CODEX_HOME: codexHome };
    assert.deepEqual(presentHosts(withCodex, resolveHostConfigDirs(withCodex)).map((h) => [h.client, h.evidence]), [['cursor', `found ${join(home, '.cursor')}`], ['codex', `found ${codexHome}`]]);
    // With CODEX_HOME set, ~/.codex is not where Codex looks, so it is not evidence.
    mkdirSync(join(home, '.codex'));
    const elsewhere = { ...env, CODEX_HOME: join(fx.root, 'absent') };
    assert.deepEqual(presentHosts(elsewhere, resolveHostConfigDirs(elsewhere)).map((h) => h.client), ['cursor']);
  } finally {
    fx.cleanup();
  }
});

test('an empty PATH and HOME find nothing, and a file that is not executable is not a command', () => {
  const fx = sterile();
  try {
    const home = join(fx.root, 'home');
    mkdirSync(home);
    const empty = { PATH: '', HOME: home };
    assert.deepEqual(presentHosts(empty, resolveHostConfigDirs(empty)), []);

    const bin = join(fx.root, 'bin');
    executable(bin, 'codex', 0o644);
    mkdirSync(join(bin, 'opencode'));
    const env = { PATH: bin, HOME: home };
    assert.equal(findOnPath('codex', env), null);
    assert.equal(findOnPath('opencode', env), null);
    assert.deepEqual(presentHosts(env, resolveHostConfigDirs(env)), []);
  } finally {
    fx.cleanup();
  }
});
