/**
 * lib/op-log.mjs — per-operation structured log file for long-running CLI ops.
 *
 * Commands like `dev`, `install`, `init`, and `sync` keep their human-facing
 * output on stdout (println/ok/warn). This module adds a parallel machine log:
 * one JSONL file per run at `<home>/.cx/<op>-<timestamp>.log`, every line
 * stamped with a shared correlation id (`op_id`) so a failed run can be
 * reconstructed after the fact and concurrent runs never interleave
 * ambiguously. It reuses `makeLogger` from lib/logger.mjs for the line format.
 *
 * Writes are synchronous (an open fd + writeSync), not a buffered stream:
 * CLI ops routinely end in process.exit(), and a buffered stream can drop its
 * tail before the event loop drains it. Synchronous append loses nothing.
 *
 * Best-effort by contract: if the log dir can't be created or the file can't
 * open, the returned handle silently no-ops. Logging must never break the
 * operation it observes.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { makeLogger, newRequestId } from './logger.mjs';
import { doctorRoot } from './config/xdg.mjs';

const NOOP_LOGGER = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

export function startOpLog(op, { homeDir = os.homedir(), env = process.env, now = new Date() } = {}) {
  const id = newRequestId();
  const dir = doctorRoot(homeDir);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(dir, `${op}-${stamp}.log`);

  let fd = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fd = fs.openSync(logPath, 'a');
  } catch {
    fd = null;
  }

  // Adapt the fd to the minimal stream surface makeLogger needs: a sync write.
  const stream = fd === null ? null : { write: (line) => { try { fs.writeSync(fd, line); } catch { /* best-effort */ } } };
  const log = stream
    ? makeLogger({ env, stream }).child({ op, op_id: id })
    : NOOP_LOGGER;

  log.info('op.start', { pid: process.pid });

  return {
    id,
    logPath: fd === null ? null : logPath,
    event: (name, fields = {}) => log.info(name, fields),
    warn: (name, fields = {}) => log.warn(name, fields),
    error: (name, fields = {}) => log.error(name, fields),
    close: (status = 'ok', fields = {}) => {
      log.info('op.end', { status, ...fields });
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } fd = null; }
    },
  };
}
