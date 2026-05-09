/**
 * lib/logger.mjs — structured (JSON-line) logger for dashboard + server code.
 *
 * The CLI continues to use `println`/`errorln` for human-facing output. This
 * logger is for non-interactive surfaces (HTTP server, embed daemon,
 * supervised processes) where logs flow to a tail of stderr and a CloudWatch
 * agent or `construct logs` reads them.
 *
 * Format: one JSON object per line, on stderr. Fields:
 *
 *   ts          ISO timestamp
 *   level       'debug' | 'info' | 'warn' | 'error'
 *   event       short stable identifier (e.g. 'http.request', 'auth.fail')
 *   req_id      correlation id (defaults to a fresh hex string)
 *   route       request path (when applicable)
 *   actor       token label / user identity (when authenticated)
 *   latency_ms  request duration (server only)
 *   detail      arbitrary subobject for context
 *
 * Operators set `CONSTRUCT_LOG_LEVEL=debug` to see verbose lines; default
 * level is `info`. `CONSTRUCT_LOG_PRETTY=1` switches to a human-readable
 * format for local dev. Otherwise output is strictly JSONL.
 */

import { randomBytes } from 'node:crypto';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function thresholdFromEnv(env) {
  const v = (env.CONSTRUCT_LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[v] ?? LEVELS.info;
}

function isPretty(env) {
  return env.CONSTRUCT_LOG_PRETTY === '1' || env.CONSTRUCT_LOG_PRETTY === 'true';
}

export function newRequestId() {
  return randomBytes(8).toString('hex');
}

export function makeLogger({ env = process.env, stream = process.stderr } = {}) {
  const threshold = thresholdFromEnv(env);
  const pretty = isPretty(env);

  function emit(level, event, fields = {}) {
    if (LEVELS[level] < threshold) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      event,
      ...fields,
    };
    const line = pretty
      ? `[${record.ts}] ${level.padEnd(5)} ${event}${
          Object.keys(fields).length ? ' ' + JSON.stringify(fields) : ''
        }\n`
      : JSON.stringify(record) + '\n';
    try { stream.write(line); } catch { /* logging is best-effort */ }
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info:  (event, fields) => emit('info',  event, fields),
    warn:  (event, fields) => emit('warn',  event, fields),
    error: (event, fields) => emit('error', event, fields),
    child(extra = {}) {
      return makeLogger.scoped(this, extra);
    },
  };
}

makeLogger.scoped = (parent, extra) => ({
  debug: (event, fields = {}) => parent.debug(event, { ...extra, ...fields }),
  info:  (event, fields = {}) => parent.info(event,  { ...extra, ...fields }),
  warn:  (event, fields = {}) => parent.warn(event,  { ...extra, ...fields }),
  error: (event, fields = {}) => parent.error(event, { ...extra, ...fields }),
  child(more = {}) { return makeLogger.scoped(parent, { ...extra, ...more }); },
});

let defaultLogger = null;
export function logger() {
  if (!defaultLogger) defaultLogger = makeLogger();
  return defaultLogger;
}
