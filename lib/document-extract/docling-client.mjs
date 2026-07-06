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
 *   extractViaDocling(filePath) → { markdown, metadata, droppedInfo }
 *   shutdownDoclingSidecar()    → idempotent process exit
 *
 * The first call provisions the shared, machine-scoped venv on demand via
 * ensureDoclingVenv() — never at `construct init`, only on first extraction
 * (construct-rf26.16). Subsequent calls reuse the running sidecar.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDoclingVenv } from '../runtime/uv-bootstrap.mjs';

const SIDECAR_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'docling-sidecar.py');
const REQUEST_TIMEOUT_MS = 300_000;

let activeSidecar = null;
let sidecarStarting = null;
let requestSeq = 0;

async function spawnSidecar({ runtimeDir } = {}) {
  const { pythonBin } = await ensureDoclingVenv({ runtimeDir });
  const child = spawn(pythonBin, [SIDECAR_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  const pending = new Map();
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let exitReason = null;

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
      catch { continue; }
      const id = message.id;
      const handler = pending.get(id);
      if (!handler) continue;
      pending.delete(id);
      clearTimeout(handler.timer);
      if (message.error) handler.reject(Object.assign(new Error(message.error.message || 'docling sidecar error'), { code: message.error.code, trace: message.error.trace }));
      else handler.resolve(message.result);
    }
  });

  child.stderr.on('data', (chunk) => { stderrBuffer += chunk; });

  child.on('exit', (code) => {
    exitReason = `exit code ${code}`;
    for (const [, handler] of pending) {
      clearTimeout(handler.timer);
      handler.reject(new Error(`docling sidecar exited (${exitReason}); stderr: ${stderrBuffer.slice(-500)}`));
    }
    pending.clear();
    if (activeSidecar === sidecar) activeSidecar = null;
  });

  function send(method, params = {}) {
    if (child.killed || child.exitCode !== null) {
      return Promise.reject(new Error(`docling sidecar not running: ${exitReason || 'killed'}`));
    }
    const id = ++requestSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`docling sidecar timeout after ${REQUEST_TIMEOUT_MS}ms (method=${method})`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  const sidecar = { send, child, get stderr() { return stderrBuffer; } };
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

process.on('exit', () => { if (activeSidecar) activeSidecar.child.kill('SIGTERM'); });
