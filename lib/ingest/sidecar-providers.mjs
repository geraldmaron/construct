/**
 * lib/ingest/sidecar-providers.mjs — governed install/health probes for ingestion sidecars.
 *
 * docling (document extraction, provisioned via uv venv) and whisper (audio
 * transcription, provisioned as a system/cached binary) are ingestion providers
 * declared as `ingestion-provider` manifests under lib/extensions/manifests/.
 * The single place that turns a manifest's `installProbe` and `healthCheck`
 * declarations into an actual probe result, and exposes the manifest's
 * `degradation.chain` for the ingest pipeline to consume.
 *
 * Every probe accepts an injectable `exec`/`fs` seam so doctor and CLI tests can
 * exercise the present AND absent code paths without depending on the real uv
 * venv or whisper-cli binary being installed on the test machine (FAKE probes).
 * Nothing here throws on absence — a missing sidecar is a reportable state
 * (`installed: false`), never a crash.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { loadManifestsFromDir, resolveManifestDirs } from '../extensions/loader.mjs';

export const SIDECAR_PROVIDER_IDS = ['docling', 'whisper'];

function loadManifest(id) {
  const { builtin } = resolveManifestDirs();
  const { manifests, errors } = loadManifestsFromDir(builtin);
  const manifest = manifests.find((m) => m.id === id && m.kind === 'ingestion-provider');
  if (!manifest) {
    const relevantError = errors.find((e) => e.includes(`${id}.manifest.json`));
    return { manifest: null, error: relevantError || `no ingestion-provider manifest found for '${id}'` };
  }
  return { manifest, error: null };
}

function which(bin, { execImpl = spawnSync } = {}) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = execImpl(checker, [bin], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n')[0] || null;
}

// docling's install probe reads the venv marker the same way
// lib/runtime/uv-bootstrap.mjs does, but through an injectable fs seam so tests
// can simulate "marker present, venv missing" (stale install) and "nothing
// present" without touching the real filesystem.

function probeDoclingInstall({ runtimeDir, existsImpl = existsSync, readFileImpl = readFileSync } = {}) {
  const pythonBin = join(runtimeDir, '.venv', 'bin', 'python');
  const pythonBin3 = join(runtimeDir, '.venv', 'bin', 'python3');
  const venvPython = existsImpl(pythonBin) ? pythonBin : (existsImpl(pythonBin3) ? pythonBin3 : null);
  const markerPath = join(runtimeDir, '.install-marker.json');

  if (!existsImpl(markerPath)) {
    return { installed: false, version: null, reason: 'no install marker at ' + markerPath };
  }
  let marker;
  try {
    marker = JSON.parse(readFileImpl(markerPath, 'utf8'));
  } catch (err) {
    return { installed: false, version: null, reason: `install marker unreadable: ${err.message}` };
  }
  if (!venvPython) {
    return { installed: false, version: marker.doclingVersion || null, reason: 'install marker present but venv python binary missing (stale install)' };
  }
  return { installed: true, version: marker.doclingVersion || null, reason: null, pythonBin: venvPython, runtimeDir };
}

// whisper's install probe mirrors lib/runtime/whisper-bootstrap.mjs's PATH +
// cached-binary lookup, again through an injectable exec/fs seam.

function probeWhisperInstall({ runtimeDir, candidates, cachedBinaryRel, execImpl = spawnSync, existsImpl = existsSync } = {}) {
  for (const candidate of candidates) {
    const found = which(candidate, { execImpl });
    if (found) return { installed: true, version: null, reason: null, binary: found, source: 'system' };
  }
  const cached = join(runtimeDir, cachedBinaryRel);
  if (existsImpl(cached)) {
    return { installed: true, version: null, reason: null, binary: cached, source: 'cached' };
  }
  return { installed: false, version: null, reason: `not found on PATH (${candidates.join(', ')}) or cached at ${cached}` };
}

/**
 * probeInstall(id, opts) — install probe for a governed ingestion provider.
 *
 * @param {string} id 'docling' | 'whisper'
 * @param {object} [opts]
 * @param {string} [opts.runtimeDir] override runtime dir (defaults to manifest's declared default under cwd)
 * @param {string} [opts.cwd]
 * @param {Function} [opts.existsImpl] injectable fs.existsSync (fake probes)
 * @param {Function} [opts.readFileImpl] injectable fs.readFileSync (fake probes)
 * @param {Function} [opts.execImpl] injectable spawnSync (fake probes)
 * @returns {{ ok: boolean, installed: boolean, version: (string|null), reason: (string|null), manifest: object }}
 */
export function probeInstall(id, { runtimeDir = null, cwd = process.cwd(), existsImpl = existsSync, readFileImpl = readFileSync, execImpl = spawnSync } = {}) {
  const { manifest, error } = loadManifest(id);
  if (!manifest) return { ok: false, installed: false, version: null, reason: error, manifest: null };

  const probeSpec = manifest.installProbe;
  const resolvedRuntimeDir = runtimeDir || join(cwd, probeSpec.defaultRuntimeDir);

  if (probeSpec.kind === 'venv-marker') {
    const result = probeDoclingInstall({ runtimeDir: resolvedRuntimeDir, existsImpl, readFileImpl });
    return { ok: true, ...result, manifest };
  }
  if (probeSpec.kind === 'binary-on-path') {
    const result = probeWhisperInstall({
      runtimeDir: resolvedRuntimeDir,
      candidates: probeSpec.candidates,
      cachedBinaryRel: probeSpec.cachedBinary,
      execImpl,
      existsImpl,
    });
    return { ok: true, ...result, manifest };
  }
  return { ok: false, installed: false, version: null, reason: `unknown installProbe.kind '${probeSpec.kind}'`, manifest };
}

/**
 * probeHealth(id, opts) — health check for a governed ingestion provider.
 *
 * Runs only when the install probe reports `installed: true`; a not-installed
 * provider is unhealthy by definition and this short-circuits without
 * spawning a process (so a missing binary never masquerades as an
 * exec failure).
 *
 * @param {string} id 'docling' | 'whisper'
 * @param {object} [opts] same injectable seams as probeInstall, plus:
 * @param {Function} [opts.execImpl] injectable spawnSync for the health subprocess (fake probes)
 * @returns {{ ok: boolean, healthy: boolean, detail: string, installProbe: object }}
 */
export function probeHealth(id, { runtimeDir = null, cwd = process.cwd(), existsImpl = existsSync, readFileImpl = readFileSync, execImpl = spawnSync } = {}) {
  const installProbe = probeInstall(id, { runtimeDir, cwd, existsImpl, readFileImpl, execImpl });
  if (!installProbe.ok) {
    return { ok: false, healthy: false, detail: installProbe.reason, installProbe };
  }
  if (!installProbe.installed) {
    return { ok: true, healthy: false, detail: `${id} not installed: ${installProbe.reason}`, installProbe };
  }

  const check = installProbe.manifest.healthCheck;
  if (check.kind !== 'subprocess-version') {
    return { ok: false, healthy: false, detail: `unknown healthCheck.kind '${check.kind}'`, installProbe };
  }

  const command = check.command === '<resolvedBinary>'
    ? installProbe.binary
    : check.command.replace('<runtimeDir>', installProbe.runtimeDir);
  const args = check.args.map((a) => (a === '<runtimeDir>' ? installProbe.runtimeDir : a));
  const result = execImpl(command, args, { encoding: 'utf8', timeout: check.timeoutMs });

  if (result.error) {
    return { ok: true, healthy: false, detail: `${id} health check failed to spawn: ${result.error.message}`, installProbe };
  }
  if (result.status !== 0) {
    return { ok: true, healthy: false, detail: `${id} health check exited ${result.status}: ${(result.stderr || result.stdout || '').trim().slice(0, 200)}`, installProbe };
  }
  const output = (result.stdout || result.stderr || '').trim();
  return { ok: true, healthy: true, detail: output ? `${id} ${output.split('\n')[0]}` : `${id} healthy`, installProbe };
}

/**
 * degradationChain(id) — the manifest-declared fallback chain for a provider.
 *
 * @param {string} id
 * @returns {{ chain: Array<{id:string, mode:string, description:string}>, terminal: string, resultMarking: string }|null}
 */
export function degradationChain(id) {
  const { manifest } = loadManifest(id);
  return manifest?.degradation || null;
}

/**
 * testProvider(id, opts) — combined install+health probe shaped for CLI/doctor
 * consumption (`construct provider test docling`). Never throws: an absent
 * provider degrades loudly (`ok: true, healthy: false`) rather than crashing.
 *
 * @param {string} id
 * @param {object} [opts] same injectable seams as probeHealth
 * @returns {{ id: string, installed: boolean, healthy: boolean, version: (string|null), detail: string, degradation: object|null }}
 */
export function testProvider(id, opts = {}) {
  if (!SIDECAR_PROVIDER_IDS.includes(id)) {
    return { id, installed: false, healthy: false, version: null, detail: `unknown ingestion provider '${id}'; known: ${SIDECAR_PROVIDER_IDS.join(', ')}`, degradation: null };
  }
  const health = probeHealth(id, opts);
  return {
    id,
    installed: !!health.installProbe?.installed,
    healthy: health.healthy,
    version: health.installProbe?.version || null,
    detail: health.detail,
    degradation: degradationChain(id),
  };
}
