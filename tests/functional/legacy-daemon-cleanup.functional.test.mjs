/**
 * legacy-daemon-cleanup.functional.test.mjs — the sweeper kills leaked legacy
 * daemons and purges their stale state (construct-b0nny.29).
 *
 * Drives the real runLegacyCleanup() path end to end: plants a live node
 * process whose argv carries a tmpdir-scoped lib/oracle/daemon-entry.mjs
 * sentinel (found through the same exported matcher production uses, real ps
 * scan, real SIGTERM) and a full set of stale durable state under an isolated
 * homeDir — oracle runtime dir, doctor.json, detached-spawn logs, and a
 * dead-pid port-ownership record — then asserts the process dies, the stale
 * state is gone, a live-pid ownership record survives, and a second run is a
 * quiet no-op. Matcher precision is pinned too: an editor, a grep, or a
 * non-daemon module holding the same filename must never match.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  matchesLegacyDaemonCommand,
  findLegacyDaemonProcesses,
  runLegacyCleanup,
  sweepLegacyState,
} from '../../lib/legacy-cleanup.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

// XDG overrides and CONSTRUCT_DOCTOR_ROOT would relocate stateDir/doctorRoot
// away from the sandbox homeDir, so the sweeps run against an empty env.

const STERILE_ENV = {};

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processAlive(pid);
}

function plantStaleState(homeDir) {
  const stateRoot = path.join(homeDir, '.local', 'state', 'construct');
  const oracleRuntime = path.join(stateRoot, 'runtime', 'oracle');
  fs.mkdirSync(oracleRuntime, { recursive: true });
  fs.writeFileSync(path.join(oracleRuntime, 'heartbeat.json'), JSON.stringify({ pid: 999_999_001, at: new Date().toISOString() }));
  fs.writeFileSync(path.join(oracleRuntime, 'last-tick.json'), JSON.stringify({ at: new Date().toISOString(), verdict: 'healthy' }));
  fs.writeFileSync(path.join(stateRoot, 'doctor.json'), JSON.stringify({ pid: 999_999_002, startedAt: Date.now() }));
  const runtime = path.join(stateRoot, 'runtime');
  fs.writeFileSync(path.join(runtime, 'doctor.log'), 'stale\n');
  fs.writeFileSync(path.join(runtime, 'oracle-daemon.log'), 'stale\n');
  fs.writeFileSync(path.join(runtime, 'port-7071.json'), JSON.stringify({ pid: 999_999_003, marker: 'construct', constructManaged: true }));
  fs.writeFileSync(path.join(runtime, 'port-7072.json'), JSON.stringify({ pid: process.pid, marker: 'construct', constructManaged: true }));
  return {
    oracleRuntime,
    doctorState: path.join(stateRoot, 'doctor.json'),
    doctorLog: path.join(runtime, 'doctor.log'),
    oracleLog: path.join(runtime, 'oracle-daemon.log'),
    deadPortRecord: path.join(runtime, 'port-7071.json'),
    livePortRecord: path.join(runtime, 'port-7072.json'),
  };
}

test('matcher precision: daemon argv matches, lookalike commands never do', () => {
  assert.equal(matchesLegacyDaemonCommand('node /opt/construct/lib/oracle/daemon-entry.mjs'), true);
  assert.equal(matchesLegacyDaemonCommand('/usr/local/bin/node /opt/construct/lib/doctor/index.mjs'), true);
  assert.equal(matchesLegacyDaemonCommand('node -e setInterval(()=>{},1e3) /tmp/x/lib/oracle/daemon-entry.mjs'), true);
  assert.equal(matchesLegacyDaemonCommand('vim lib/oracle/daemon-entry.mjs'), false);
  assert.equal(matchesLegacyDaemonCommand('grep -r lib/doctor/index.mjs .'), false);
  assert.equal(matchesLegacyDaemonCommand('node /opt/construct/lib/doctor/cli.mjs doctor'), false);
  assert.equal(matchesLegacyDaemonCommand('node /opt/construct/lib/oracle/daemon-entry.mjs.bak'), false);
  assert.equal(matchesLegacyDaemonCommand('node'), false);
  assert.equal(matchesLegacyDaemonCommand(''), false);
});

test('sweeper kills a planted fake daemon and purges planted stale state', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-cleanup-'));
  const homeDir = path.join(root, 'HOME');
  fs.mkdirSync(homeDir, { recursive: true });
  t.after(() => rmTmpDir(root));

  // A long-running node process whose argv carries the daemon-entry sentinel
  // path inside this test's tmpdir. The -e script ignores extra argv, so the
  // process idles until signalled — exactly the leaked-daemon shape.
  const sentinel = path.join(root, 'lib', 'oracle', 'daemon-entry.mjs');
  const fake = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', sentinel], { stdio: 'ignore' });
  t.after(() => {
    try { process.kill(fake.pid, 'SIGKILL'); } catch {}
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(processAlive(fake.pid), true, 'planted fake daemon must be running before the sweep');

  const found = findLegacyDaemonProcesses();
  assert.ok(
    found.some((p) => p.pid === fake.pid),
    `production matcher must find the planted daemon via the real ps scan (found: ${JSON.stringify(found)})`,
  );

  const planted = plantStaleState(homeDir);
  const { killed, purged } = runLegacyCleanup({ homeDir, env: STERILE_ENV });

  assert.ok(killed.some((p) => p.pid === fake.pid), `sweep must SIGTERM the planted daemon (killed: ${JSON.stringify(killed)})`);
  assert.equal(await waitForExit(fake.pid), true, 'planted daemon must be dead after the sweep');

  assert.equal(fs.existsSync(planted.oracleRuntime), false, 'oracle runtime dir must be purged');
  assert.equal(fs.existsSync(planted.doctorState), false, 'doctor.json must be purged');
  assert.equal(fs.existsSync(planted.doctorLog), false, 'doctor.log must be purged');
  assert.equal(fs.existsSync(planted.oracleLog), false, 'oracle-daemon.log must be purged');
  assert.equal(fs.existsSync(planted.deadPortRecord), false, 'dead-pid port-ownership record must be purged');
  assert.equal(fs.existsSync(planted.livePortRecord), true, 'live-pid port-ownership record must survive');
  assert.ok(purged.includes(planted.oracleRuntime), 'purge report must name the oracle runtime dir');
});

test('sweep is an idempotent quiet no-op on a clean home', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-cleanup-clean-'));
  const homeDir = path.join(root, 'HOME');
  fs.mkdirSync(homeDir, { recursive: true });
  try {
    assert.deepEqual(sweepLegacyState(homeDir, { env: STERILE_ENV }), []);
    assert.deepEqual(sweepLegacyState(homeDir, { env: STERILE_ENV }), []);
  } finally {
    rmTmpDir(root);
  }
});
