/**
 * tests/session-start-hook.test.mjs — Integration test for the session-start hook.
 *
 * Spawns lib/hooks/session-start.mjs as a child process with a temporary .construct/context.json
 * and verifies it exits 0 and emits a "Resuming" context block to stdout. The output
 * mode is pinned to stdout so the emission contract is exercised regardless of an
 * ambient non-interactive signal (e.g. CI=true), which `auto` would route to silent.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { rmTmpDir } from './helpers/cleanup.mjs';
import { doctorRoot } from '../lib/config/xdg.mjs';

test('session-start hook remains non-blocking and emits resume context', (t) => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-session-start-'));
  t.after(() => { rmTmpDir(cwd); });
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct', 'context.json'), `${JSON.stringify({ format: 'json', savedAt: new Date().toISOString(), markdown: '# Session Context\n' }, null, 2)}\n`);

  const result = spawnSync('node', [path.join(repoRoot, 'lib', 'hooks', 'session-start.mjs')], {
    cwd,
    input: JSON.stringify({ cwd }),
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, CONSTRUCT_HOOK_OUTPUT_MODE: 'stdout', HOME: cwd, CONSTRUCT_HOME_OVERRIDE: cwd },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Resuming/);
});

test('session-start reads global context from Construct machine state', (t) => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-session-start-global-project-'));
  const constructHome = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-session-start-global-home-'));
  t.after(() => { rmTmpDir(cwd); rmTmpDir(constructHome); });

  const globalConfigDir = path.join(doctorRoot(constructHome), '.construct');
  fs.mkdirSync(globalConfigDir, { recursive: true });
  fs.writeFileSync(
    path.join(globalConfigDir, 'context.json'),
    `${JSON.stringify({
      format: 'json',
      savedAt: new Date().toISOString(),
      markdown: '# Global Construct context\n\nGLOBAL-CONTEXT-MARKER\n',
    }, null, 2)}\n`,
  );

  const result = spawnSync('node', [path.join(repoRoot, 'lib', 'hooks', 'session-start.mjs')], {
    cwd,
    input: JSON.stringify({ cwd }),
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      CONSTRUCT_HOOK_OUTPUT_MODE: 'stdout',
      CONSTRUCT_HOME_OVERRIDE: constructHome,
      HOME: cwd,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GLOBAL-CONTEXT-MARKER/);
});

// The "Provider sources wired" hint is built by iterating the manifest-declared
// source-target descriptors, not by naming providers inline, so every configured
// provider_fetch source is surfaced instead of a hardcoded subset.
// Configuring all four network providers via legacy env must name all four.

test('session-start names every configured provider_fetch source in the wired-sources hint', (t) => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-session-start-sources-'));
  t.after(() => { rmTmpDir(cwd); });

  const result = spawnSync('node', [path.join(repoRoot, 'lib', 'hooks', 'session-start.mjs')], {
    cwd,
    input: JSON.stringify({ cwd }),
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      CONSTRUCT_HOOK_OUTPUT_MODE: 'stdout',
      HOME: cwd,
      CONSTRUCT_HOME_OVERRIDE: cwd,
      GITHUB_REPOS: 'acme/app',
      JIRA_PROJECTS: 'ENG',
      LINEAR_TEAMS: 'core',
      SLACK_CHANNELS: 'general',
    },
  });

  assert.equal(result.status, 0);
  const line = result.stdout.split('\n').find((l) => l.includes('Provider sources wired'));
  assert.ok(line, `expected a wired-sources hint.\nstdout: ${result.stdout.slice(0, 800)}`);
  for (const value of ['acme/app', 'ENG', 'core', 'general']) {
    assert.match(line, new RegExp(value), `hint should name the ${value} source`);
  }
});
