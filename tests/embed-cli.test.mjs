/**
 * tests/embed-cli.test.mjs — resolveEmbedStatus and runEmbedCli start unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveEmbedStatus, runEmbedCli } from '../lib/embed/cli.mjs';
import { doctorRoot } from '../lib/config/xdg.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, '../lib/embed/cli.mjs');

// --foreground blocks the CLI process itself (the process an OS supervisor
// like launchd/systemd tracks) until the worker exits, so it must run out of
// process — calling it in-process would set this test runner's own exit
// code. Each test below writes a tiny runner script that calls runEmbedCli
// with a synthetic worker, then observes the real subprocess exit code.
function writeForegroundRunner(tmpDir, workerPath) {
  const runnerPath = path.join(tmpDir, 'runner.mjs');
  fs.writeFileSync(runnerPath, `
import { runEmbedCli } from ${JSON.stringify(pathToFileURL(CLI_PATH).href)};
await runEmbedCli(['start', '--foreground'], {
  homeDir: ${JSON.stringify(tmpDir)},
  rootDir: ${JSON.stringify(tmpDir)},
  _workerPath: ${JSON.stringify(workerPath)},
});
`);
  return runnerPath;
}

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
    rmTmpDir(tmpDir);
  });

  it('returns level=stopped when Jira credentials present but no daemon state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-test-'));
    const status = resolveEmbedStatus({
      JIRA_API_TOKEN: 'tok',
      JIRA_USER_EMAIL: 'a@b.com',
      JIRA_BASE_URL: 'https://x.atlassian.net',
    }, tmpDir);
    assert.equal(status.level, 'stopped');
    rmTmpDir(tmpDir);
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
    rmTmpDir(tmpDir);
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
    rmTmpDir(tmpDir);
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
      rmTmpDir(tmpDir);
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
      rmTmpDir(tmpDir);
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
      rmTmpDir(tmpDir);
    }
  });
});

describe('runEmbedCli start --foreground (crash-restart contract)', () => {
  it('blocks until the worker exits and exits non-zero when the worker crashes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-fg-'));
    try {
      const crashWorker = path.join(tmpDir, 'crash-worker.mjs');
      fs.writeFileSync(crashWorker, 'process.exit(7);\n');
      const runner = writeForegroundRunner(tmpDir, crashWorker);

      const result = spawnSync(process.execPath, [runner], { encoding: 'utf8' });

      assert.equal(result.status, 7, 'CLI process must exit with the worker crash code, not 0');
      const stateFile = path.join(doctorRoot(tmpDir), 'runtime', 'embed-daemon.json');
      assert.equal(fs.existsSync(stateFile), false, 'state file should be cleared after the worker exits');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('propagates a clean worker exit code (0) rather than mismatching it', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-fg-'));
    try {
      const exitZeroWorker = path.join(tmpDir, 'exit-zero-worker.mjs');
      fs.writeFileSync(exitZeroWorker, 'process.exit(0);\n');
      const runner = writeForegroundRunner(tmpDir, exitZeroWorker);

      const result = spawnSync(process.execPath, [runner], { encoding: 'utf8' });

      assert.equal(result.status, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('actually blocks — the CLI process does not return before the worker exits', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-fg-'));
    try {
      const slowWorker = path.join(tmpDir, 'slow-worker.mjs');
      fs.writeFileSync(slowWorker, 'await new Promise(r => setTimeout(r, 500));\nprocess.exit(0);\n');
      const runner = writeForegroundRunner(tmpDir, slowWorker);

      const startedAt = Date.now();
      const result = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
      const elapsedMs = Date.now() - startedAt;

      assert.equal(result.status, 0);
      assert.ok(elapsedMs >= 450, `expected the CLI process to block for the worker's ~500ms lifetime, only took ${elapsedMs}ms`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('forwards SIGTERM to the worker and exits 0 on a deliberate stop, not a crash code', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-fg-'));
    try {
      const longWorker = path.join(tmpDir, 'long-worker.mjs');
      fs.writeFileSync(longWorker, 'await new Promise(r => setTimeout(r, 10000));\n');
      const runner = writeForegroundRunner(tmpDir, longWorker);

      const child = spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`worker never reported ready; stdout so far: ${stdout}`)), 5000);
        const check = () => {
          if (stdout.includes('embed daemon started in foreground')) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout.on('data', check);
        check();
      });

      child.kill('SIGTERM');

      const exitCode = await new Promise((resolve) => {
        child.on('exit', (code) => resolve(code));
      });

      assert.equal(exitCode, 0, 'a signaled stop (mirroring `embed stop`) must exit cleanly, not as a crash');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
