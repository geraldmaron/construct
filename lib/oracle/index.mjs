/**
 * lib/oracle/index.mjs — Oracle meta-controller daemon.
 *
 * Periodic tick over the read model with bounded-auto execution. Built on
 * lib/daemons/contract.mjs safeguards. Disabled when CONSTRUCT_ORACLE=off.
 * Heartbeat: ~/.cx/runtime/oracle/heartbeat.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import { createDaemon } from '../daemons/contract.mjs';
import { memoryCapMbFor } from '../resources/process-budget.mjs';
import { runOracleTick, defaultRootDir } from './actions.mjs';
import { doctorRoot } from '../config/xdg.mjs';

export const KILLSWITCH_ENV = 'CONSTRUCT_ORACLE';

function runtimeDir(homeDir = homedir()) {
  return path.join(doctorRoot(homeDir), 'runtime', 'oracle');
}

export function heartbeatPath(homeDir = homedir()) {
  return path.join(runtimeDir(homeDir), 'heartbeat.json');
}

export function lastTickPath(homeDir = homedir()) {
  return path.join(runtimeDir(homeDir), 'last-tick.json');
}

function writeLastTick(tick, homeDir) {
  const dir = runtimeDir(homeDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lastTickPath(homeDir), JSON.stringify(tick, null, 2));
}

export function readLastTick(homeDir = homedir()) {
  const file = lastTickPath(homeDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build a DaemonRunner for the Oracle meta-controller.
 */
export function buildOracleDaemon({
  rootDir = defaultRootDir(),
  projectDir = process.cwd(),
  homeDir = homedir(),
  intervalMs = 5 * 60_000,
  dryRun = false,
} = {}) {
  return createDaemon({
    name: 'oracle',
    intervalMs,
    killswitchEnv: KILLSWITCH_ENV,
    heartbeatPath: heartbeatPath(homeDir),
    lockPath: path.join(runtimeDir(homeDir), 'oracle.lock'),
    maxRuntimeMs: 24 * 60 * 60 * 1000,
    maxIdleTicks: 3,
    memoryCapMb: memoryCapMbFor('oracle', projectDir),
    async tick() {
      const result = await runOracleTick({ rootDir, projectDir, homeDir, dryRun });
      writeLastTick(result.tick, homeDir);
      const didWork = result.tick.executed.length > 0
        || result.tick.queued.length > 0
        || (result.tick.beadsRaised?.length ?? 0) > 0
        || result.verdict !== 'healthy';
      return { didWork };
    },
  });
}

/**
 * Run the Oracle daemon until idle shutdown, killswitch, or max runtime.
 */
export async function runOracleDaemon(opts = {}) {
  const daemon = buildOracleDaemon(opts);
  return daemon.run();
}
