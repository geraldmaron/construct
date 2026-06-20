/**
 * lib/ingest-tooling.mjs — detect optional binaries for document ingestion.
 *
 * Probes docling venv, whisper-cli, unpdf/mammoth optional deps, and
 * docling-remote URL config for construct tools detect and doctor.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveDoclingServeUrl } from './ingest/docling-remote.mjs';

function whichBin(name) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split('\n')[0] || null;
}

export function doclingVenvPath(cwd = process.cwd()) {
  return path.join(cwd, '.cx', 'runtime', 'docling', '.venv');
}

export function detectDoclingSidecar({ cwd = process.cwd() } = {}) {
  const venv = doclingVenvPath(cwd);
  const python = process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
  const present = fs.existsSync(python);
  return {
    ok: true,
    present,
    venvDir: venv,
    pythonBin: present ? python : null,
    message: present
      ? `Docling venv ready at ${venv}`
      : 'Docling not provisioned — runs on first high-fidelity ingest or construct install --with-docling',
  };
}

export function detectNodeNativeDeps({ repoRoot = process.cwd() } = {}) {
  const unpdf = fs.existsSync(path.join(repoRoot, 'node_modules', 'unpdf'));
  const mammoth = fs.existsSync(path.join(repoRoot, 'node_modules', 'mammoth'));
  const present = unpdf && mammoth;
  return {
    ok: true,
    present,
    unpdf,
    mammoth,
    message: present
      ? 'Node-native extraction ready (unpdf + mammoth)'
      : `Missing optional deps: ${[!unpdf && 'unpdf', !mammoth && 'mammoth'].filter(Boolean).join(', ') || 'none'}`,
  };
}

export function detectWhisper(env = process.env) {
  const cli = whichBin('whisper-cli') || whichBin('whisper');
  return {
    ok: true,
    present: Boolean(cli),
    path: cli,
    message: cli
      ? `ASR ready (${cli})`
      : 'Install whisper-cpp for audio/video ingest (brew install whisper-cpp on macOS)',
  };
}

export function detectDoclingRemote(env = process.env) {
  const url = resolveDoclingServeUrl(env);
  return {
    ok: true,
    present: Boolean(url),
    url: url || null,
    message: url
      ? `docling-remote configured (${url})`
      : 'Set DOCLING_SERVE_URL for docling-remote ingest strategy',
  };
}

export function detectIngestPipeline({ cwd = process.cwd(), env = process.env, repoRoot = cwd } = {}) {
  const steps = {
    docling: detectDoclingSidecar({ cwd }),
    nodeNative: detectNodeNativeDeps({ repoRoot }),
    whisper: detectWhisper(env),
    doclingRemote: detectDoclingRemote(env),
  };
  return {
    ok: true,
    present: steps.docling.present || steps.nodeNative.present,
    steps,
    message: steps.docling.present
      ? 'Ingest: high-fidelity docling ready'
      : steps.nodeNative.present
        ? 'Ingest: fast tier ready (unpdf/mammoth); high-fidelity provisions on first use'
        : 'Ingest degraded — install optional deps or run construct install --with-docling',
  };
}
