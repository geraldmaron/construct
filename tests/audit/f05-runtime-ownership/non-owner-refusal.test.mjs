/**
 * tests/audit/f05-runtime-ownership/non-owner-refusal.red.mjs — F05 [R16] blind-kill proof.
 *
 * RED fixtures (must FAIL against current code). lib/service-manager.mjs stopServices()
 * (L494-523) reads the CONFIGURED ports from the user env file, then calls
 * killPortOwners() (L479-492) which runs `lsof -t -i:PORT` and `process.kill(pid,
 * 'SIGTERM')` on whatever PID currently owns that port. It never proves the PID was
 * launched by Construct, matches a recorded command/cwd, carries a Construct env marker,
 * or holds a Construct lock. A stale or mistyped configured port therefore makes
 * `construct stop` terminate an unrelated developer process that merely happens to be
 * listening on that port.
 *
 * Contract these encode (CX-AUDIT-RUNTIME-003): stop must verify ownership BEFORE
 * termination. A port owner with no Construct ownership markers must be REPORTED, not
 * killed. `killedUnverifiedPid()` is the post-fix observable — it watches the real kill
 * call. Today stop kills the unverified PID, so the "kill was NOT invoked" assertion
 * fails, proving the unsafe blind kill. No real process is ever signalled: process.kill
 * is monkeypatched to record (pid, signal) and swallow the call.
 *
 * The fixture passes once stop consults an ownership predicate and refuses to signal a
 * PID lacking Construct markers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { stopServices } from '../../../lib/service-manager.mjs';
import { getUserEnvPath } from '../../../lib/env-config.mjs';

const FOREIGN_PID = 999_000_001;

// getUserEnvPath resolves against XDG_CONFIG_HOME when set; neutralize both XDG axes so
// the configured ports come from the tmp home this fixture controls, never host state.

function makeHome(envLines) {
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_STATE_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f05-nonowner-'));
  const envPath = getUserEnvPath(home);
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, `${envLines.join('\n')}\n`, 'utf8');
  return home;
}

// process.kill is the real termination call inside killPortOwners. Intercepting it lets
// the fixture observe what stop WOULD signal without ending any process on the host.

// fn's returned promise (stopServices is async) must resolve before the real
// process.kill is restored. An unawaited `fn()` would restore the real
// process.kill before fn's first internal await resolves, letting any later
// process.kill call inside stopServices hit the real function instead of the
// recorder below — the one behavior the ownership-refusal proof depends on.

async function withKillRecorder(fn) {
  const realKill = process.kill;
  const signalled = [];
  process.kill = (pid, signal) => {
    signalled.push({ pid: Number(pid), signal });
    return true;
  };
  try {
    const value = await fn();
    return { signalled, value };
  } finally {
    process.kill = realKill;
  }
}

function lsofReturning(pid) {
  return (cmd, args) => {
    if (cmd === 'lsof') return { status: 0, stdout: `${pid}\n`, stderr: '' };
    return { status: 1, stdout: '', stderr: '' };
  };
}

test('[R16] stop must NOT kill a configured-port owner that lacks Construct ownership markers', async (t) => {
  const home = makeHome(['MEMORY_PORT=7070', 'BRIDGE_PORT=5173', 'COPILOT_BRIDGE_PORT=5174']);
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });

  const { signalled, value: result } = await withKillRecorder(() => stopServices({
    homeDir: home,
    spawnSyncFn: lsofReturning(FOREIGN_PID),
  }));

  assert.ok(
    !signalled.some((s) => s.pid === FOREIGN_PID),
    `stop blind-killed PID ${FOREIGN_PID} which holds no Construct ownership marker. `
      + `signalled=${JSON.stringify(signalled)} results=${JSON.stringify(result.results)}`,
  );
});

test('[R16] an unverified port owner is REPORTED, not counted as stopped', async (t) => {
  const home = makeHome(['MEMORY_PORT=7070']);
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });

  const { value: result } = await withKillRecorder(() => stopServices({
    homeDir: home,
    spawnSyncFn: lsofReturning(FOREIGN_PID),
  }));

  const memory = result.results.find((r) => r.name === 'Memory (cm)');
  assert.ok(memory, 'memory service result present');
  assert.notEqual(
    memory.status,
    'stopped',
    `stop reported an unowned port owner as "stopped"; a foreign PID must be reported, not killed. result=${JSON.stringify(memory)}`,
  );
});
