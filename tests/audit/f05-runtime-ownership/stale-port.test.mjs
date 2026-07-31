/**
 * tests/audit/f05-runtime-ownership/stale-port.red.mjs — F05 [R16] stale-configured-port proof.
 *
 * RED fixture (must FAIL against current code). A configured port can go stale: the env
 * file records MEMORY_PORT=N, Construct's own service exits, and an unrelated developer
 * process later binds N. stopServices() then reads the stale N and kills whatever owns it
 * via killPortOwners() (lib/service-manager.mjs L479-492), with no check that the owner
 * is Construct's. The fixture stands up a REAL but harmless child process owning the
 * configured port, then asserts `stop` does not signal it.
 *
 * The harmless child runs `node -e "setInterval(...)"` bound to a loopback TCP port in a
 * tmp home, standing in for an arbitrary developer process. process.kill is monkeypatched
 * so the child is never actually signalled even if stop tries — teardown happens
 * explicitly in t.after. The configured port is set to the child's real listening port,
 * and lsof is faked to report the child's real PID (so the test never shells out).
 *
 * Contract (004): an owner lacking Construct ownership markers
 * (PID/command/cwd/env-marker/lock recorded at start) must be REPORTED, not killed.
 * Current stop signals the foreign owner, so the assertion fails — proving the hazard.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { stopServices } from '../../../lib/service-manager.mjs';
import { getUserEnvPath } from '../../../lib/env-config.mjs';
import { rmTmpDir } from '../../helpers/cleanup.mjs';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// A harmless foreign owner: binds the loopback port and idles, carrying no Construct
// ownership marker — exactly the developer process a stale configured port endangers.

function spawnForeignOwner(port) {
  const child = spawn(
    process.execPath,
    ['-e', `require('net').createServer().listen(${port}, '127.0.0.1'); setInterval(() => {}, 1e9);`],
    { stdio: 'ignore' },
  );
  child.unref();
  return child;
}

function writeEnv(home, port) {
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_STATE_HOME;
  const envPath = getUserEnvPath(home);
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, `MEMORY_PORT=${port}\n`, 'utf8');
}

test('[R16] stop must not kill the foreign owner of a stale configured port', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f05-stale-'));
  const port = await freePort();
  const foreign = spawnForeignOwner(port);

  const realKill = process.kill;
  const signalled = [];
  process.kill = (pid, signal) => {
    signalled.push({ pid: Number(pid), signal });
    return true;
  };

  t.after(() => {
    process.kill = realKill;
    try { realKill.call(process, foreign.pid, 'SIGKILL'); } catch {}
    rmTmpDir(home);
  });

  await new Promise((resolve) => setTimeout(resolve, 150));
  writeEnv(home, port);

  const result = await stopServices({
    homeDir: home,
    spawnSyncFn: (cmd) => (cmd === 'lsof'
      ? { status: 0, stdout: `${foreign.pid}\n`, stderr: '' }
      : { status: 1, stdout: '', stderr: '' }),
  });

  assert.ok(
    !signalled.some((s) => s.pid === foreign.pid),
    `stop killed foreign PID ${foreign.pid} owning stale configured port ${port}; `
      + `it has no Construct ownership marker and must be reported. signalled=${JSON.stringify(signalled)} `
      + `results=${JSON.stringify(result.results)}`,
  );
});
