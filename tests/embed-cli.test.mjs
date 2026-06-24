/**
 * tests/embed-cli.test.mjs — resolveEmbedStatus and runEmbedCli start unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveEmbedStatus, runEmbedCli } from '../lib/embed/cli.mjs';
import { doctorRoot } from '../lib/config/xdg.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('resolveEmbedStatus', () => {
  it('returns level=none when no provider credentials present', () => {
    const status = resolveEmbedStatus({});
    assert.equal(status.level, 'none');
  });

  it('returns level=stopped when GitHub token present but no daemon state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-test-'));
    const status = resolveEmbedStatus({ GITHUB_TOKEN: 'ghp_fake' }, tmpDir);
    assert.equal(status.level, 'stopped');
    assert.ok(status.label.includes('stopped'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns level=stopped when Jira credentials present but no daemon state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-test-'));
    const status = resolveEmbedStatus({
      JIRA_API_TOKEN: 'tok',
      JIRA_USER_EMAIL: 'a@b.com',
      JIRA_BASE_URL: 'https://x.atlassian.net',
    }, tmpDir);
    assert.equal(status.level, 'stopped');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns level=running when state file has live pid (self)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-test-'));
    const runtimeDir = path.join(doctorRoot(tmpDir), 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'embed-daemon.json'),
      JSON.stringify({ pid: process.pid, configPath: 'auto', startedAt: new Date().toISOString() }),
    );
    const status = resolveEmbedStatus({ GITHUB_TOKEN: 'ghp_fake' }, tmpDir);
    assert.equal(status.level, 'running');
    assert.ok(status.label.includes('running'));
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns level=stopped when state file has dead pid', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-test-'));
    const runtimeDir = path.join(doctorRoot(tmpDir), 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    // PID 999999999 is guaranteed non-existent
    fs.writeFileSync(
      path.join(runtimeDir, 'embed-daemon.json'),
      JSON.stringify({ pid: 999999999, configPath: 'auto', startedAt: new Date().toISOString() }),
    );
    const status = resolveEmbedStatus({ GITHUB_TOKEN: 'ghp_fake' }, tmpDir);
    assert.equal(status.level, 'stopped');
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('runEmbedCli start', () => {
  it('throws when worker path does not exist', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-start-'));
    try {
      await assert.rejects(
        () => runEmbedCli(['start'], {
          homeDir: tmpDir,
          rootDir: tmpDir,
          _workerPath: path.join(tmpDir, 'nonexistent-worker.mjs'),
        }),
        /embed worker not found/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('throws and clears state when worker crashes immediately', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-start-'));
    // Write a worker that exits immediately with a non-zero code
    const badWorker = path.join(tmpDir, 'crash-worker.mjs');
    fs.writeFileSync(badWorker, 'process.exit(1);\n');
    try {
      await assert.rejects(
        () => runEmbedCli(['start'], {
          homeDir: tmpDir,
          rootDir: tmpDir,
          _workerPath: badWorker,
          _livenessCheckMs: 300,
        }),
        /exited immediately/,
      );
      // State file must be cleaned up
      const stateFile = path.join(doctorRoot(tmpDir), 'runtime', 'embed-daemon.json');
      assert.equal(fs.existsSync(stateFile), false, 'state file should be cleared after crash');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns normally and creates state file when worker stays alive', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-start-'));
    // Write a worker that sleeps long enough to survive the liveness check
    const goodWorker = path.join(tmpDir, 'stay-alive-worker.mjs');
    fs.writeFileSync(goodWorker, 'await new Promise(r => setTimeout(r, 5000));\n');
    let pid;
    try {
      await runEmbedCli(['start'], {
        homeDir: tmpDir,
        rootDir: tmpDir,
        _workerPath: goodWorker,
        _livenessCheckMs: 200,
      });
      const stateFile = path.join(doctorRoot(tmpDir), 'runtime', 'embed-daemon.json');
      assert.ok(fs.existsSync(stateFile), 'state file should exist after successful start');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.ok(state.pid, 'state should contain a pid');
      pid = state.pid;
    } finally {
      if (pid) {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      }
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
