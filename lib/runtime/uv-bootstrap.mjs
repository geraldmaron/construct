/**
 * lib/runtime/uv-bootstrap.mjs — idempotent uv + docling venv provisioner.
 *
 * One venv per machine, not one per project (construct-rf26.16; ADR-0066
 * called this out as the docling venv's terminal shape). On first use:
 * downloads uv via the official Astral installer, then runs
 * `uv sync --frozen` against the committed lib/runtime/docling-runtime/
 * pyproject.toml + uv.lock (construct-tsyfe.10.3), redirecting the resulting
 * environment to `~/.construct/runtime/docling/.venv` via
 * `UV_PROJECT_ENVIRONMENT` (resolveSharedRuntimeDir picks the shared dir).
 * `--frozen` makes uv fail rather than silently re-resolve if the lockfile
 * and pyproject.toml ever drift, so the transitive dependency graph (torch,
 * transformers, onnxruntime, ...) installs at the exact checksummed versions
 * recorded in uv.lock — not whatever is newest on PyPI that day.
 * Subsequent calls from any project on this machine are no-ops once the
 * venv is present — there is no project key anywhere in this path.
 *
 * Version pin is two-layered: DOCLING_PIN gates the fast path via
 * `.install-marker.json`'s `doclingVersion` field (a mismatch — e.g. a
 * construct upgrade that bumps the pin — clears the stale venv directory and
 * re-provisions from scratch rather than layering a new install over an old
 * one), and lib/runtime/docling-runtime/pyproject.toml pins the actual
 * `docling==` version uv installs. A functional test asserts the two stay
 * in sync.
 *
 * Best-practice notes (2026-06):
 *   - uv (Astral) is the consensus Python tooling, ~10× faster than pip, single
 *     binary, lockfile-based. OpenAI acquired Astral on 2026-03-19; the project
 *     remains Apache-2.0 and actively maintained, but single-vendor governance
 *     is a documented concern — flagged for re-evaluation if licensing shifts.
 *   - docling (IBM, MIT, donated to LF AI & Data early 2026) is the consensus
 *     multi-format doc parser for layout-aware MD/JSON output.
 *
 * Returns the path to the venv's python binary so callers can spawn the
 * sidecar without relying on PATH state.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSharedRuntimeDir } from '../state-root.mjs';

export const DOCLING_PIN = '2.45.0';
export const DOCLING_PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'docling-runtime');
const UV_INSTALL_URL = 'https://astral.sh/uv/install.sh';
const UV_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 600_000;

// ensureDir:false — shared by the provisioner (ensureDoclingVenv, which
// already mkdirs before it writes) and the read-only detector
// (describeDoclingRuntime); a detect-only call must not conjure the dir.

export function defaultRuntimeDir() {
  return resolveSharedRuntimeDir('docling', { ensureDir: false });
}

function which(bin) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n')[0] || null;
}

// Provisioning runs on the request path (the first docling ingest), including
// inside the long-lived MCP server. spawnSync would block the event loop for the
// whole multi-minute install — freezing every other request and defeating the
// per-tool dispatch timeout. Run each step via async spawn instead, shaped to
// mirror spawnSync's result so describeStepFailure reads it unchanged.

function runAsync(cmd, args, { timeoutMs, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs) : null;
    child.on('error', (error) => { if (timer) clearTimeout(timer); resolve({ status: null, stdout, stderr, error, signal: null }); });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ status: code, stdout, stderr, signal: timedOut ? 'SIGTERM' : signal, error: timedOut ? { code: 'ETIMEDOUT' } : null });
    });
  });
}

// First-run docling provisioning blocks for minutes (uv install, then a large
// `uv sync` against the pinned lockfile that pulls ML deps). Without a
// heartbeat it reads as a hang. Progress goes to stderr only, so JSON
// consumers on stdout are unaffected; it is the long-operation's own
// channel, not a suppressible notice.

function progress(message) {
  try { process.stderr.write(`[docling setup] ${message}\n`); } catch { /* stderr closed */ }
}

// spawnSync sets status=null and error.code=ETIMEDOUT on timeout; distinguish a
// timeout from a real non-zero exit so the message tells the user what to do.

function describeStepFailure(label, result, timeoutMs) {
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
    return `${label} timed out after ${Math.round(timeoutMs / 1000)}s — docling's one-time download did not complete. Check network/proxy and re-run; or set ingest.fallback to "adapter" to skip docling.`;
  }
  return `${label} failed (${result.status}): ${result.stderr || result.stdout || result.error?.message || 'unknown error'}`;
}

async function ensureUv(installDir) {
  const fromPath = which('uv');
  if (fromPath) return fromPath;
  const cachedUv = path.join(installDir, 'bin', 'uv');
  if (existsSync(cachedUv)) return cachedUv;
  mkdirSync(installDir, { recursive: true });
  progress('Installing uv (Python toolchain) — first run only…');
  const env = { ...process.env, UV_INSTALL_DIR: path.join(installDir, 'bin'), UV_NO_MODIFY_PATH: '1' };
  const sh = await runAsync('sh', ['-c', `curl -LsSf ${UV_INSTALL_URL} | sh`], { env, timeoutMs: UV_TIMEOUT_MS });
  if (sh.status !== 0) {
    throw new Error(describeStepFailure('uv install', sh, UV_TIMEOUT_MS));
  }
  if (!existsSync(cachedUv)) {
    throw new Error(`uv install reported success but binary not found at ${cachedUv}`);
  }
  return cachedUv;
}

function pythonBinFor(venvDir) {
  const candidates = process.platform === 'win32'
    ? [path.join(venvDir, 'Scripts', 'python.exe')]
    : [path.join(venvDir, 'bin', 'python'), path.join(venvDir, 'bin', 'python3')];
  return candidates.find((p) => existsSync(p));
}

function readMarker(markerPath) {
  try { return JSON.parse(readFileSync(markerPath, 'utf8')); }
  catch { return null; }
}

function writeMarker(markerPath, payload) {
  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

export async function ensureDoclingVenv({ runtimeDir = defaultRuntimeDir(), force = false } = {}) {
  mkdirSync(runtimeDir, { recursive: true });
  const venvDir = path.join(runtimeDir, '.venv');
  const markerPath = path.join(runtimeDir, '.install-marker.json');
  const existingMarker = readMarker(markerPath);
  const existingPython = pythonBinFor(venvDir);

  if (!force && existingPython && existingMarker?.doclingVersion === DOCLING_PIN) {
    return { pythonBin: existingPython, venvDir, runtimeDir, fresh: false };
  }

  // A version-pin mismatch (existingMarker present but doclingVersion !== DOCLING_PIN)
  // is a controlled re-provision, not silent drift: clear the stale venv outright
  // rather than trust `uv sync` to reconcile an existing directory left by a
  // different docling/Python pin.

  if (existingMarker && existingMarker.doclingVersion !== DOCLING_PIN) {
    progress(`Pinned docling version changed (${existingMarker.doclingVersion} → ${DOCLING_PIN}) — re-provisioning.`);
    try { rmSync(venvDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  progress('Provisioning the docling document extractor (first run). This downloads a Python runtime and ML dependencies and can take several minutes; later runs are instant.');
  const uv = await ensureUv(runtimeDir);

  // --frozen refuses to re-resolve if lib/runtime/docling-runtime/pyproject.toml
  // and uv.lock have drifted apart, so this always installs the exact
  // checksummed dependency graph the lockfile records — not a fresh resolve
  // against whatever is newest on PyPI. --no-install-project skips building the
  // manifest's own placeholder package (it has no source, only a dependency
  // list); UV_PROJECT_ENVIRONMENT redirects the venv uv sync creates from the
  // repo-relative project dir out to the machine-shared runtimeDir.

  progress(`Syncing pinned docling ${DOCLING_PIN} runtime from lib/runtime/docling-runtime/uv.lock — the slow step (large download)…`);
  const syncEnv = { ...process.env, UV_PROJECT_ENVIRONMENT: venvDir };
  const syncResult = await runAsync(
    uv,
    ['sync', '--project', DOCLING_PROJECT_DIR, '--frozen', '--no-install-project', '--python', '3.11'],
    { timeoutMs: INSTALL_TIMEOUT_MS, env: syncEnv },
  );
  if (syncResult.status !== 0) {
    throw new Error(describeStepFailure('docling venv sync', syncResult, INSTALL_TIMEOUT_MS));
  }
  progress('docling extractor ready.');

  const pythonBin = pythonBinFor(venvDir);
  writeMarker(markerPath, {
    doclingVersion: DOCLING_PIN,
    installedAt: new Date().toISOString(),
    pythonBin,
    uvVersion: spawnSync(uv, ['--version'], { encoding: 'utf8' }).stdout.trim() || null,
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
  });

  return { pythonBin, venvDir, runtimeDir, fresh: true };
}

export function describeDoclingRuntime({ runtimeDir = defaultRuntimeDir() } = {}) {
  const venvDir = path.join(runtimeDir, '.venv');
  return {
    runtimeDir,
    venvDir,
    pythonBin: pythonBinFor(venvDir),
    marker: readMarker(path.join(runtimeDir, '.install-marker.json')),
    available: !!pythonBinFor(venvDir),
  };
}
