/**
 * lib/oracle/index.mjs — durable last-tick and heartbeat state readers for the
 * retired Oracle overseer.
 *
 * The Oracle background daemon loop is deleted: nothing
 * schedules a periodic tick, directive execution runs under E5
 * (lib/workplace-loop/), and read-model reconciliation runs under E1
 * (lib/graph/relational/reconcile.mjs). What remains here is the last-tick and
 * heartbeat state accessors the one-shot `construct oracle review`/`status`
 * CLI and lib/intake/session-prelude.mjs still read. KILLSWITCH_ENV is kept so
 * the CLI status surface reports the same killswitch flag it always did.
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

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

export function writeLastTick(tick, homeDir = homedir()) {
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
