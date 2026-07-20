/**
 * lib/document-extract/docling-client.mjs — Node side of the docling sidecar.
 *
 * Implements the ingestion sidecar process contract (ADR-0068): spawns one
 * long-lived Python process per Node session, framed by newline-delimited
 * JSON over stdin/stdout, as a direct child (so the sidecar's own parent-PID
 * watch resolves the right PID with no explicit handoff needed). Avoids
 * per-call uv/venv warm-up (~2s otherwise) and keeps the docling model
 * resident.
 *
 * Public API:
 *   extractViaDocling(filePath) → { markdown, metadata, droppedInfo, structuredDict? }
 *   shutdownDoclingSidecar()    → idempotent graceful shutdown
 *   killActiveDoclingSidecar()  → immediate kill (timeout recovery)
 *
 * Crash recovery: a per-request timeout kills the whole sidecar child
 * (SIGTERM, then SIGKILL after 2s) because docling's convert() has no
 * cancellation API and the sidecar stdin loop is synchronous. Every other
 * in-flight or queued request on that instance is rejected; getSidecar()
 * provisions a fresh sidecar for the next caller.
 *
 * Requests pass through a bounded queue (max concurrency + max queue depth)
 * so concurrent MCP/CLI ingest calls cannot pile unbounded work onto one
 * sidecar process.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDoclingVenv, DOCLING_PIN } from '../runtime/uv-bootstrap.mjs';

const SIDECAR_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'docling-sidecar.py');
const REQUEST_TIMEOUT_MS = 300_000;
const KILL_ESCALATION_MS = 2_000;
const MALFORMED_LOG_MAX = 5;
const MALFORMED_PREVIEW_CHARS = 200;
const DEFAULT_MAX_CONCURRENCY = Math.max(1, Number(process.env.CONSTRUCT_DOCLING_MAX_CONCURRENCY) || 1);
const DEFAULT_MAX_QUEUE = Math.max(1, Number(process.env.CONSTRUCT_DOCLING_MAX_QUEUE) || 32);

let activeSidecar = null;
let sidecarStarting = null;
let requestSeq = 0;
let testOverrides = null;
let exitCleanupRegistered = false;

function logSidecarWarning(message) {
  try { process.stderr.write(`[docling sidecar] ${message}\n`); } catch { /* stderr closed */ }
}

function sidecarOptions() {
  return {
    maxConcurrency: testOverrides?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    maxQueueSize: testOverrides?.maxQueueSize ?? DEFAULT_MAX_QUEUE,
    requestTimeoutMs: testOverrides?.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    pinnedVersion: testOverrides?.pinnedVersion ?? DOCLING_PIN,
    runtimeDir: testOverrides?.runtimeDir,
    pythonBin: testOverrides?.pythonBin,
    scriptPath: testOverrides?.scriptPath,
  };
}

class BoundedRequestQueue {
  constructor(sidecar, { maxConcurrency, maxQueueSize }) {
    this.sidecar = sidecar;
    this.maxConcurrency = maxConcurrency;
    this.maxQueueSize = maxQueueSize;
    this.inFlight = 0;
    this.waiting = [];
  }

  get stats() {
    return { inFlight: this.inFlight, queued: this.waiting.length, maxConcurrency: this.maxConcurrency };
  }

  enqueue(method, params) {
    return new Promise((resolve, reject) => {
      if (this.waiting.length >= this.maxQueueSize) {
        reject(Object.assign(new Error(`docling sidecar queue full (${this.maxQueueSize} waiting)`), { code: 'DOCLING_QUEUE_FULL' }));
        return;
      }
      this.waiting.push({ method, params, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.inFlight < this.maxConcurrency && this.waiting.length > 0) {
      const job = this.waiting.shift();
      this.inFlight += 1;
      this.sidecar.send(job.method, job.params)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.inFlight -= 1;
          this.drain();
        });
    }
  }

  rejectAll(error) {
    const pending = this.waiting.splice(0);
    for (const job of pending) job.reject(error);
  }
}

function attachDiagnostics(error, sidecar) {
  if (!sidecar?.diagnostics) return error;
  const { malformedMessageCount, malformedMessagePreviews } = sidecar.diagnostics;
  if (malformedMessageCount > 0) {
    Object.assign(error, { malformedMessageCount, malformedMessagePreviews });
  }
  return error;
}

function killChildWithEscalation(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  }, KILL_ESCALATION_MS);
  timer.unref?.();
}

export async function spawnSidecar(options = {}) {
  const {
    runtimeDir,
    pythonBin: pythonBinOverride,
    scriptPath = SIDECAR_SCRIPT,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    pinnedVersion = DOCLING_PIN,
  } = options;

  const pythonBin = pythonBinOverride ?? (await ensureDoclingVenv({ runtimeDir })).pythonBin;
  const child = spawn(pythonBin, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  const pending = new Map();
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let exitReason = null;
  let malformedMessageCount = 0;
  const malformedMessagePreviews = [];

  function recordMalformedLine(rawLine) {
    malformedMessageCount += 1;
    const preview = rawLine.length > MALFORMED_PREVIEW_CHARS
      ? `${rawLine.slice(0, MALFORMED_PREVIEW_CHARS)}…`
      : rawLine;
    malformedMessagePreviews.push(preview);
    while (malformedMessagePreviews.length > MALFORMED_LOG_MAX) malformedMessagePreviews.shift();
    logSidecarWarning(`malformed sidecar stdout line (#${malformedMessageCount}): ${preview}`);
  }

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let newlineIdx;
    while ((newlineIdx = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIdx);
      stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { recordMalformedLine(line); continue; }
      const id = message.id;
      const handler = pending.get(id);
      if (!handler) {
        logSidecarWarning(`orphan sidecar response id=${id} (no pending handler)`);
        continue;
      }
      pending.delete(id);
      clearTimeout(handler.timer);
      if (message.error) {
        handler.reject(Object.assign(
          new Error(message.error.message || 'docling sidecar error'),
          { code: message.error.code, trace: message.error.trace },
        ));
      } else {
        handler.resolve(message.result);
      }
    }
  });

  child.stderr.on('data', (chunk) => { stderrBuffer += chunk; });

  child.on('exit', (code, signal) => {
    exitReason = signal ? `signal ${signal}` : `exit code ${code}`;
    const exitError = attachDiagnostics(
      new Error(`docling sidecar exited (${exitReason}); stderr: ${stderrBuffer.slice(-500)}`),
      sidecar,
    );
    for (const [, handler] of pending) {
      clearTimeout(handler.timer);
      handler.reject(exitError);
    }
    pending.clear();
    sidecar.queue?.rejectAll(exitError);
    if (activeSidecar === sidecar) activeSidecar = null;
  });

  function send(method, params = {}) {
    if (child.killed || child.exitCode !== null) {
      return Promise.reject(attachDiagnostics(
        new Error(`docling sidecar not running: ${exitReason || 'killed'}`),
        sidecar,
      ));
    }
    const id = ++requestSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        killChildWithEscalation(child);
        const timeoutError = attachDiagnostics(
          Object.assign(new Error(`docling sidecar timeout after ${requestTimeoutMs}ms (method=${method})`), { code: 'DOCLING_SIDECAR_TIMEOUT' }),
          sidecar,
        );
        reject(timeoutError);
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  const sidecar = {
    send,
    child,
    get stderr() { return stderrBuffer; },
    get diagnostics() {
      return {
        malformedMessageCount,
        malformedMessagePreviews: [...malformedMessagePreviews],
      };
    },
    queue: null,
  };

  const ping = await send('ping');
  const reportedVersion = ping?.doclingVersion ?? null;
  if (reportedVersion !== pinnedVersion) {
    killChildWithEscalation(child);
    throw Object.assign(
      new Error(`docling sidecar version mismatch: sidecar reports ${reportedVersion ?? 'unknown'}, pinned ${pinnedVersion}`),
      { code: 'DOCLING_VERSION_MISMATCH', expected: pinnedVersion, actual: reportedVersion },
    );
  }

  return sidecar;
}

async function getSidecar() {
  if (activeSidecar && activeSidecar.child.exitCode === null && !activeSidecar.child.killed) return activeSidecar;
  if (!sidecarStarting) {
    const opts = sidecarOptions();
    sidecarStarting = spawnSidecar(opts).then(
      (s) => {
        s.queue = new BoundedRequestQueue(s, {
          maxConcurrency: opts.maxConcurrency,
          maxQueueSize: opts.maxQueueSize,
        });
        activeSidecar = s;
        sidecarStarting = null;
        registerExitCleanup();
        return s;
      },
      (e) => { sidecarStarting = null; throw e; },
    );
  }
  return sidecarStarting;
}

function registerExitCleanup() {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  const cleanup = () => { cleanupDoclingSidecarOnExit(); };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

export function cleanupDoclingSidecarOnExit() {
  if (!activeSidecar) return;
  const sidecar = activeSidecar;
  activeSidecar = null;
  killChildWithEscalation(sidecar.child);
}

function protocolDropEntries(sidecar) {
  const { malformedMessageCount, malformedMessagePreviews } = sidecar.diagnostics;
  if (!malformedMessageCount) return [];
  return [{
    kind: 'sidecar-protocol-warning',
    count: malformedMessageCount,
    reason: `Observed ${malformedMessageCount} malformed sidecar stdout line(s) during extraction${malformedMessagePreviews.length ? `: ${malformedMessagePreviews.join(' | ')}` : ''}.`,
    recoverable: true,
  }];
}

export async function extractViaDocling(filePath) {
  const sidecar = await getSidecar();
  const result = await sidecar.queue.enqueue('extract', { path: path.resolve(filePath) });
  const protocolDrops = protocolDropEntries(sidecar);
  if (protocolDrops.length === 0) return result;
  return {
    ...result,
    droppedInfo: [...(result.droppedInfo ?? []), ...protocolDrops],
  };
}

export async function shutdownDoclingSidecar() {
  if (!activeSidecar) return;
  const sidecar = activeSidecar;
  activeSidecar = null;
  try { await sidecar.send('shutdown'); } catch { /* sidecar already gone */ }
  if (sidecar.child.exitCode === null && !sidecar.child.killed) {
    sidecar.child.kill('SIGTERM');
  }
}

export function killActiveDoclingSidecar() {
  cleanupDoclingSidecarOnExit();
}

export function configureDoclingClientForTests(overrides) {
  testOverrides = overrides ?? null;
}

export async function resetDoclingSidecarForTests() {
  await shutdownDoclingSidecar();
  activeSidecar = null;
  sidecarStarting = null;
  testOverrides = null;
}

export function getDoclingSidecarQueueStats() {
  return activeSidecar?.queue?.stats ?? null;
}

export function getActiveDoclingSidecarForTests() {
  return activeSidecar;
}
