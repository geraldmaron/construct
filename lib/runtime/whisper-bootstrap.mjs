/**
 * lib/runtime/whisper-bootstrap.mjs — provision whisper.cpp binary + ASR model.
 *
 * Strategy (2026-06):
 *   1. Prefer system-installed whisper-cli (or legacy `main`) on PATH —
 *      `brew install whisper-cpp` (macOS, Metal-accelerated) or distro
 *      package on Linux.
 *   2. Fall back to bundled `whisper-cli` cached at <runtimeDir>/bin/ if a
 *      previous bootstrap fetched one.
 *   3. If neither, return a structured "not-available" descriptor — caller
 *      surfaces a user-actionable install hint rather than crashing.
 *
 * Model files are downloaded directly from Hugging Face the first time the
 * default `base.en` (or env-overridden) model is requested. Models cache at
 * <stateRoot>/runtime/whisper/models/ (ADR-0066: machine-scoped, not
 * project-local). base.en is ~150MB; smaller than the small.en or medium.en
 * model that callers can opt into via CONSTRUCT_WHISPER_MODEL.
 *
 * No bundled distribution: whisper.cpp upstream does not publish stable
 * pre-built CLI binaries across platforms, and building from source via
 * cmake adds a heavyweight first-run path. Defer that to a future opt-in.
 */
import { existsSync, mkdirSync, statSync, createWriteStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';

import { resolveStateDir } from '../state-root.mjs';

const HF_MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const DEFAULT_MODEL = process.env.CONSTRUCT_WHISPER_MODEL || 'base.en';
const KNOWN_MODELS = new Set(['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large-v3', 'large-v3-turbo']);

// ensureDir:false — shared by the provisioner (ensureWhisperRuntime, which
// already mkdirs before it writes) and the read-only detector
// (describeWhisperRuntime/locateWhisperBinary); a detect-only call must not
// conjure the dir.

export function defaultRuntimeDir(cwd = process.cwd()) {
  return resolveStateDir(cwd, 'runtime', 'whisper', { ensureDir: false });
}

function which(bin) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n')[0] || null;
}

export function locateWhisperBinary({ runtimeDir = defaultRuntimeDir() } = {}) {
  for (const candidate of ['whisper-cli', 'whisper-cpp', 'main']) {
    const found = which(candidate);
    if (found) return { binary: found, source: 'system', name: candidate };
  }
  const cached = path.join(runtimeDir, 'bin', 'whisper-cli');
  if (existsSync(cached)) return { binary: cached, source: 'cached', name: 'whisper-cli' };
  return null;
}

export function describeWhisperRuntime({ runtimeDir = defaultRuntimeDir() } = {}) {
  const located = locateWhisperBinary({ runtimeDir });
  const modelPath = modelPathFor(DEFAULT_MODEL, runtimeDir);
  return {
    runtimeDir,
    binary: located,
    defaultModel: DEFAULT_MODEL,
    modelPath,
    modelInstalled: existsSync(modelPath),
    available: !!located,
  };
}

export function installHint() {
  if (process.platform === 'darwin') return 'brew install whisper-cpp';
  if (process.platform === 'linux') return 'See https://github.com/ggml-org/whisper.cpp#quick-start (build from source via cmake or install via your distro package manager).';
  return 'See https://github.com/ggml-org/whisper.cpp#quick-start';
}

function modelPathFor(modelName, runtimeDir) {
  return path.join(runtimeDir, 'models', `ggml-${modelName}.bin`);
}

export async function ensureWhisperModel({ runtimeDir = defaultRuntimeDir(), model = DEFAULT_MODEL } = {}) {
  if (!KNOWN_MODELS.has(model)) {
    throw new Error(`unknown whisper model: ${model} (allowed: ${[...KNOWN_MODELS].join(', ')})`);
  }
  const target = modelPathFor(model, runtimeDir);
  if (existsSync(target) && statSync(target).size > 1024) return target;
  mkdirSync(path.dirname(target), { recursive: true });
  const url = `${HF_MODEL_BASE_URL}/ggml-${model}.bin`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`failed to download whisper model ${model}: ${response.status} ${response.statusText} (${url})`);
  }
  await pipeline(response.body, createWriteStream(target));
  return target;
}

export async function ensureWhisperRuntime({ runtimeDir = defaultRuntimeDir(), model = DEFAULT_MODEL } = {}) {
  mkdirSync(runtimeDir, { recursive: true });
  const located = locateWhisperBinary({ runtimeDir });
  if (!located) {
    const err = new Error(`whisper-cli not found; install via: ${installHint()}`);
    err.code = 'WHISPER_BINARY_MISSING';
    err.installHint = installHint();
    throw err;
  }
  const modelPath = await ensureWhisperModel({ runtimeDir, model });
  return { binary: located.binary, source: located.source, modelPath, model };
}
