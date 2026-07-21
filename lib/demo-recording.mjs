/**
 * lib/demo-recording.mjs — load and validate Playwright recording manifests.
 *
 * Canonical definitions live in Demo Manifests (lib/demo-manifest.mjs). Legacy
 * search dirs (.construct/demos/recordings/, templates/demos/recordings/) remain
 * for backward-compatible reconciliation until all callers migrate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPath, CONFIG_DIR_NAME } from './config-dir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DEMO_MANIFEST_SCHEMA = 'construct/demo-manifest/1';

function demoManifestDirs({ cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  return [
    configPath(cwd, 'demos', 'manifests'),
    path.join(repoRoot, 'templates', 'demos', 'manifests'),
  ];
}

function readManifestRecording(name, opts) {
  for (const dir of demoManifestDirs(opts)) {
    const candidate = path.join(dir, `${name}.json`);
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (raw.schema !== DEMO_MANIFEST_SCHEMA || !raw.recording) continue;
      return { recording: raw.recording, sourcePath: candidate, manifest: raw };
    } catch {
      continue;
    }
  }
  return null;
}

export function demoRecordingSearchDirs({ cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  return [
    configPath(cwd, 'demos', 'recordings'),
    path.join(repoRoot, 'templates', 'demos', 'recordings'),
  ];
}

export function resolveDemoRecordingPath(name, { cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  for (const dir of demoRecordingSearchDirs({ cwd, repoRoot })) {
    const candidate = path.join(dir, `${name}.json`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function listDemoRecordings({ cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  const seen = new Set();
  const out = [];
  for (const dir of demoManifestDirs({ cwd, repoRoot })) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const name = path.basename(file, '.json');
      if (seen.has(name)) continue;
      const manifestRecording = readManifestRecording(name, { cwd, repoRoot });
      if (!manifestRecording) continue;
      seen.add(name);
      out.push(name);
    }
  }
  if (out.length > 0) return out.sort();

  for (const dir of demoRecordingSearchDirs({ cwd, repoRoot })) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const name = path.basename(file, '.json');
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out.sort();
}

export function normalizeArtifactReveal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const file = raw.file || raw.path;
  if (!file) return null;
  return {
    mode: raw.mode || 'constructPreview',
    staticDir: raw.staticDir || '.',
    file,
    scroll: raw.scroll !== false,
  };
}

function validateRecording(raw, name) {
  const errors = [];
  if (!raw || typeof raw !== 'object') errors.push('recording must be an object');
  if (raw.engine && raw.engine !== 'playwright') errors.push(`unsupported engine: ${raw.engine}`);
  if (!raw.spec) errors.push('spec is required');
  if (!raw.skipWebServer && !raw.webServer && !raw.baseUrl) {
    errors.push('baseUrl or webServer required when skipWebServer is false');
  }
  return {
    ok: errors.length === 0,
    errors,
    recording: errors.length === 0 ? normalizeRecording(raw, name) : null,
  };
}

export function normalizeRecording(raw, name) {
  return {
    name: raw.name || name,
    title: raw.title || name,
    engine: raw.engine || 'playwright',
    workspace: raw.workspace || '.',
    spec: raw.spec,
    baseUrl: raw.baseUrl || raw.webServer?.url || null,
    webServer: raw.webServer || null,
    skipWebServer: Boolean(raw.skipWebServer),
    project: raw.project || null,
    playwrightConfig: raw.playwrightConfig || null,
    artifactReveal: normalizeArtifactReveal(raw.artifactReveal),
    output: raw.output || { format: 'mp4', path: `${CONFIG_DIR_NAME}/demos/${name}.mp4` },
    timeout: raw.timeout || null,
    sourcePath: raw.sourcePath || null,
    _legacy: Boolean(raw._legacy),
  };
}

export function loadDemoRecording(name, { cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  const fromManifest = readManifestRecording(name, { cwd, repoRoot });
  if (fromManifest) {
    const validated = validateRecording({ ...fromManifest.recording, name: fromManifest.recording.name || name }, name);
    if (!validated.ok) return null;
    return {
      ...validated.recording,
      sourcePath: fromManifest.sourcePath,
      _manifest: fromManifest.manifest,
    };
  }

  const filePath = resolveDemoRecordingPath(name, { cwd, repoRoot });
  if (!filePath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const validated = validateRecording(raw, name);
    if (!validated.ok) return null;
    return { ...validated.recording, sourcePath: filePath };
  } catch {
    return null;
  }
}

export function loadDemoRecordingValidated(name, opts = {}) {
  const fromManifest = readManifestRecording(name, opts);
  if (fromManifest) {
    const validated = validateRecording(
      { ...fromManifest.recording, name: fromManifest.recording.name || name },
      name,
    );
    if (!validated.ok) {
      return { ok: false, errors: validated.errors, sourcePath: fromManifest.sourcePath };
    }
    return {
      ok: true,
      recording: {
        ...validated.recording,
        sourcePath: fromManifest.sourcePath,
        _manifest: fromManifest.manifest,
      },
    };
  }

  const filePath = resolveDemoRecordingPath(name, opts);
  if (!filePath) {
    return { ok: false, errors: [`recording not found: ${name}`] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const validated = validateRecording(raw, name);
    if (!validated.ok) return { ok: false, errors: validated.errors, sourcePath: filePath };
    return { ok: true, recording: { ...validated.recording, sourcePath: filePath } };
  } catch (err) {
    return { ok: false, errors: [err.message || 'invalid JSON'], sourcePath: filePath };
  }
}
