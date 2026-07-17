/**
 * tests/functional/daemon-contract-tick-error-heartbeat.functional.test.mjs —
 *
 * Regression test for the Oracle self-shutdown incident: a daemon built on
 * lib/daemons/contract.mjs's createDaemon() must persist the last thrown
 * tick error into its heartbeat file instead of silently discarding it, so
 * an idle self-shutdown caused by repeated tick failures is distinguishable
 * on disk from a legitimate no-work idle shutdown.
 *
 * @capability daemons.contract
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDaemon } from '../../lib/daemons/contract.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

test('N consecutive thrown tick errors persist to heartbeat.lastError, and a later successful tick clears it', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'daemon-contract-heartbeat-'));
  const hbPath = join(homeDir, 'heartbeat.json');
  try {
    let callCount = 0;
    const spec = {
      name: 'contract-error-test',
      intervalMs: 5,
      heartbeatPath: hbPath,
      maxIdleTicks: 3,
      async tick() {
        callCount++;
        throw new Error(`boom-${callCount}`);
      },
    };
    const daemon = createDaemon(spec);

    const result = await daemon.run();

    assert.equal(result.reason, 'idle', 'daemon self-shuts-down on repeated tick failures, exactly like the Oracle incident');
    assert.equal(callCount, 3);

    const hbAfterFailures = JSON.parse(readFileSync(hbPath, 'utf8'));
    assert.ok(hbAfterFailures.lastError, 'heartbeat must record the last thrown error, not discard it');
    assert.equal(hbAfterFailures.lastError.message, 'boom-3');
    assert.equal(typeof hbAfterFailures.lastError.ts, 'number');

    let stopSignaled = false;
    spec.tick = async () => {
      if (!stopSignaled) {
        stopSignaled = true;
        daemon.stop();
      }
      return { didWork: true };
    };

    await daemon.run();

    const hbAfterSuccess = JSON.parse(readFileSync(hbPath, 'utf8'));
    assert.equal(hbAfterSuccess.lastError, null, 'a subsequent successful tick must clear lastError');
  } finally {
    rmTmpDir(homeDir);
  }
});
