/**
 * lib/runtime/uv-bootstrap.mjs — idempotent uv + docling venv provisioner.
 *
 * On first use: downloads uv via the official Astral installer, creates
 * `<rootDir>/.cx/runtime/docling/.venv`, installs the pinned docling release.
 * Subsequent calls are no-ops if the venv is already present.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const DOCLING_PIN = '2.45.0';
const UV_INSTALL_URL = 'https://astral.sh/uv/install.sh';
const UV_TIMEOUT_MS = 120_000;
const VENV_TIMEOUT_MS = 240_000;
const INSTALL_TIMEOUT_MS = 600_000;

export function defaultRuntimeDir(cwd = process.cwd()) {
  return path.join(cwd, '.cx', 'runtime', 'docling');
}

function which(bin) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n')[0] || null;
}

function ensureUv(installDir) {
  const fromPath = which('uv');
  if (fromPath) return fromPath;
  const cachedUv = path.join(installDir, 'bin', 'uv');
  if (existsSync(cachedUv)) return cachedUv;
  mkdirSync(installDir, { recursive: true });
  const env = { ...process.env, UV_INSTALL_DIR: path.join(installDir, 'bin'), UV_NO_MODIFY_PATH: '1' };
  const sh = spawnSync('sh', ['-c', `curl -LsSf ${UV_INSTALL_URL} | sh`], {
    env,
    timeout: UV_TIMEOUT_MS,
    encoding: 'utf8',
  });
  if (sh.status !== 0) {
    throw new Error(`uv install failed (${sh.status}): ${sh.stderr || sh.stdout}`);
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

export function ensureDoclingVenv({ runtimeDir = defaultRuntimeDir(), force = false } = {}) {
  mkdirSync(runtimeDir, { recursive: true });
  const venvDir = path.join(runtimeDir, '.venv');
  const markerPath = path.join(runtimeDir, '.install-marker.json');
  const existingMarker = readMarker(markerPath);
  const existingPython = pythonBinFor(venvDir);

  if (!force && existingPython && existingMarker?.doclingVersion === DOCLING_PIN) {
    return { pythonBin: existingPython, venvDir, runtimeDir, fresh: false };
  }

  const uv = ensureUv(runtimeDir);

  const venvResult = spawnSync(uv, ['venv', venvDir, '--python', '3.11'], {
    timeout: VENV_TIMEOUT_MS,
    encoding: 'utf8',
  });
  if (venvResult.status !== 0) {
    throw new Error(`uv venv failed (${venvResult.status}): ${venvResult.stderr}`);
  }

  const installResult = spawnSync(uv, ['pip', 'install', '--python', pythonBinFor(venvDir), `docling==${DOCLING_PIN}`], {
    timeout: INSTALL_TIMEOUT_MS,
    encoding: 'utf8',
  });
  if (installResult.status !== 0) {
    throw new Error(`docling install failed (${installResult.status}): ${installResult.stderr}`);
  }

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
