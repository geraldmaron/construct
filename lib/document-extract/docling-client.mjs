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
 *   extractViaDocling(filePath)   → { markdown, metadata, droppedInfo }
 *   shutdownDoclingSidecar()      → graceful RPC shutdown, falling back to a kill
 *   killActiveDoclingSidecar()    → immediate kill, no RPC round trip
 *   spawnSidecar(opts)            → exported for functional tests only; production
 *                                    code always goes through getSidecar()
 *
 * The first call provisions the shared, machine-scoped venv on demand via
 * ensureDoclingVenv() — never at `construct init`, only on first extraction
 * (construct-rf26.16). Subsequent calls reuse the running sidecar.
 *
 * Crash-recovery semantics (construct-4uxq0.9.13): docling's
 * `DocumentConverter.convert()` has no cancellation or deadline parameter
 * (verified against the pinned 2.45.0 API via `inspect.signature` — it takes
 * only source/headers/raises_on_error/max_num_pages/max_file_size/page_range),
 * and docling-sidecar.py's stdin loop is synchronous and single-request-at-a-
 * time, so it cannot even read an incoming `cancel` message while blocked
 * inside `convert()` — a message-passing cancel protocol would sit unread in
 * the pipe until the conversion finishes on its own, which defeats the
 * purpose. A per-request timeout therefore kills the sidecar process
 * (SIGTERM, escalating to SIGKILL) rather than attempting cooperative
 * cancellation. Because the sidecar handles one conversion at a time but can
 * have several requests queued behind it from concurrent callers, killing it
 * for one caller's timeout rejects every other request still pending on that
 * same instance (the existing `exit` handler below already does this) —
 * `getSidecar()` respawns a fresh sidecar for the next call, so the cost is a
 * lost in-flight batch, not a stuck or orphaned process. Bounded queueing to
 * avoid piling up multiple requests behind one slow sidecar is out of scope
 * here (construct-tsyfe.2.4).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDoclingVenv } from '../runtime/uv-bootstrap.mjs';

const SIDECAR_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'docling-sidecar.py');
const REQUEST_TIMEOUT_MS = 300_000;
const SIGKILL_GRACE_MS = 2_000;
const MALFORMED_LINE_PREVIEW_MAX = 200;
const MALFORMED_LINE_HISTORY_MAX = 5;

let activeSidecar = null;
let sidecarStarting = null;
let requestSeq = 0;

// The sidecar's stdout protocol carries extracted document text inline (the
// `result.markdown` field of a well-formed response), so a malformed line
// could be a corrupted fragment of that same content. Truncate before
// logging/retaining a preview so a parse failure never persists a document's
// contents through this diagnostic path.

function truncatePreview(line) {
  return line.length > MALFORMED_LINE_PREVIEW_MAX
    ? `${line.slice(0, MALFORMED_LINE_PREVIEW_MAX)}…(truncated, ${line.length} chars total)`
    : line;
}

function logSidecarWarning(message, detail = {}) {
  try {
    const suffix = Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : '';
    process.stderr.write(`[docling sidecar] ${message}${suffix}\n`);
  } catch { /* stderr closed */ }
}

// docling has no interruption API and the sidecar reads stdin synchronously
// one request at a time (see file header), so a timed-out request cannot be
// cancelled cooperatively — kill the process outright. SIGTERM first (the
// sidecar has no handler installed, so the OS default — immediate exit —
// applies); escalate to SIGKILL only if something is holding it open past a
// short grace period.

function killWithEscalation(child) {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  const escalate = setTimeout(() => {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  }, SIGKILL_GRACE_MS);
  escalate.unref();
}

// pythonBin/scriptPath/requestTimeoutMs are override points for functional
// tests only (they substitute a controllable fixture process and a short
// timeout in place of the real docling venv and REQUEST_TIMEOUT_MS); production
// callers never pass them, so ensureDoclingVenv() and the real sidecar script
// still resolve exactly as before.

export async function spawnSidecar({ runtimeDir, pythonBin: pythonBinOverride, scriptPath = SIDECAR_SCRIPT, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const pythonBin = pythonBinOverride ?? (await ensureDoclingVenv({ runtimeDir })).pythonBin;
  const child = spawn(pythonBin, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  const pending = new Map();
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let exitReason = null;
  let malformedCount = 0;
  const malformedRecent = [];

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  function diagnostics() {
    return { malformedMessageCount: malformedCount, malformedMessagePreview: [...malformedRecent] };
  }

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let newlineIdx;
    while ((newlineIdx = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIdx);
      stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      let message;

      // A malformed line means the caller waiting on whatever id this line
      // was meant to carry never resolves/rejects from this cause — it would
      // otherwise time out for what looks like an unrelated reason. Count and
      // retain a truncated preview so that eventual timeout/exit error can
      // say what actually happened instead of a bare "timed out".

      try {
        message = JSON.parse(line);
      } catch (parseErr) {
        malformedCount += 1;
        const preview = truncatePreview(line);
        malformedRecent.push(preview);
        if (malformedRecent.length > MALFORMED_LINE_HISTORY_MAX) malformedRecent.shift();
        logSidecarWarning(`malformed stdout line dropped (${parseErr.message})`, { malformedMessageCount: malformedCount, preview });
        continue;
      }
      const id = message.id;
      const handler = pending.get(id);
      if (!handler) {
        logSidecarWarning('response for an id with no matching pending request — possible client/sidecar protocol desync', { id });
        continue;
      }
      pending.delete(id);
      clearTimeout(handler.timer);
      if (message.error) handler.reject(Object.assign(new Error(message.error.message || 'docling sidecar error'), { code: message.error.code, trace: message.error.trace }));
      else handler.resolve(message.result);
    }
  });

  child.stderr.on('data', (chunk) => { stderrBuffer += chunk; });

  child.on('exit', (code, signal) => {
    exitReason = `exit code ${code}${signal ? ` (signal ${signal})` : ''}`;
    for (const [, handler] of pending) {
      clearTimeout(handler.timer);
      handler.reject(Object.assign(
        new Error(`docling sidecar exited (${exitReason}); stderr: ${stderrBuffer.slice(-500)}`),
        diagnostics(),
      ));
    }
    pending.clear();
    if (activeSidecar === sidecar) activeSidecar = null;
  });

  function send(method, params = {}) {
    if (child.killed || child.exitCode !== null) {
      return Promise.reject(Object.assign(new Error(`docling sidecar not running: ${exitReason || 'killed'}`), diagnostics()));
    }
    const id = ++requestSeq;
    return new Promise((resolve, reject) => {

      // docling cannot cancel an in-flight convert() and the sidecar cannot read
      // a cancel message while blocked inside it (see file header) — kill the
      // process rather than send a message it could never act on.

      const timer = setTimeout(() => {
        pending.delete(id);
        const diag = diagnostics();
        const diagNote = diag.malformedMessageCount
          ? `; ${diag.malformedMessageCount} malformed sidecar message(s) observed this session, most recent: ${JSON.stringify(diag.malformedMessagePreview.at(-1))}`
          : '';
        reject(Object.assign(
          new Error(`docling sidecar timeout after ${requestTimeoutMs}ms (method=${method})${diagNote}`),
          { code: 'DOCLING_SIDECAR_TIMEOUT', ...diag },
        ));
        logSidecarWarning(`request ${id} (method=${method}) timed out after ${requestTimeoutMs}ms — killing sidecar`, diag);
        killWithEscalation(child);
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  const sidecar = { send, child, get stderr() { return stderrBuffer; }, get diagnostics() { return diagnostics(); } };
  return sidecar;
}

// Provisioning is now async, so two concurrent extracts could both spawn a
// sidecar. Cache the in-flight start promise so the first call wins and the rest
// await it; once resolved, the running sidecar is reused directly.

async function getSidecar() {
  if (activeSidecar && activeSidecar.child.exitCode === null && !activeSidecar.child.killed) return activeSidecar;
  if (!sidecarStarting) {
    sidecarStarting = spawnSidecar().then(
      (s) => { activeSidecar = s; sidecarStarting = null; return s; },
      (e) => { sidecarStarting = null; throw e; },
    );
  }
  return sidecarStarting;
}

export async function extractViaDocling(filePath) {
  const sidecar = await getSidecar();
  const result = await sidecar.send('extract', { path: path.resolve(filePath) });
  return result;
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

// A caller that gave up on the sidecar (e.g. an outer bound in
// lib/document-ingest.mjs firing before this module's own per-request
// timeout) needs an immediate stop, not shutdownDoclingSidecar()'s graceful
// RPC round trip — that round trip would itself sit unread behind whatever
// conversion is already in flight (see file header), taking as long to hang
// as the thing the caller is trying to escape.

export function killActiveDoclingSidecar() {
  if (!activeSidecar) return false;
  const sidecar = activeSidecar;
  activeSidecar = null;
  killWithEscalation(sidecar.child);
  return true;
}

process.on('exit', () => { if (activeSidecar) activeSidecar.child.kill('SIGTERM'); });
